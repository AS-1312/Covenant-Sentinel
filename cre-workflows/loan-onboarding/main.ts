/**
 * Covenant Sentinel — Loan Onboarding Workflow
 *
 * Flow:
 *   HTTP Trigger (loan document uploaded)
 *   ↓
 *   runInNodeMode — each CRE node independently calls the AI API
 *     (Claude or OpenAI GPT-4o) with the loan document text.
 *     Each node receives the extracted covenant structure as JSON.
 *   ↓
 *   Consensus — consensusIdenticalAggregation ensures all nodes
 *     agree on the extracted covenant schema before proceeding.
 *   ↓
 *   EVMClient.writeReport() — stores the verified covenant schema
 *     in the LoanRegistry contract onchain.
 *   ↓
 *   Return — loan ID, extracted covenants, transaction hash.
 *
 * Prerequisites:
 *   - LoanRegistry must implement the IReceiver interface so that
 *     CRE's writeReport() can deliver the signed report. Grant the
 *     CRE forwarder address the WORKFLOW_ROLE in LoanRegistry.
 *   - Set CLAUDE_API_KEY or OPENAI_API_KEY in secrets.yaml.
 *   - Set CRE_ETH_PRIVATE_KEY in .env.
 */

import {
	bytesToHex,
	consensusIdenticalAggregation,
	handler,
	hexToBase64,
	HTTPCapability,
	HTTPClient,
	EVMClient,
	getNetwork,
	type HTTPPayload,
	type HTTPSendRequester,
	type Runtime,
	Runner,
	TxStatus,
	decodeJson,
	ok,
} from '@chainlink/cre-sdk'
import { type Address, encodeAbiParameters, parseAbiParameters, keccak256, toBytes } from 'viem'
import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// Config schema
// ─────────────────────────────────────────────────────────────────────────────

const configSchema = z.object({
	// AI provider: 'claude' uses Anthropic API, 'openai' uses OpenAI API
	aiProvider: z.enum(['claude', 'openai']),
	// Model name, e.g. 'claude-opus-4-6' or 'gpt-4o'
	aiModel: z.string(),
	// Deployed LoanRegistry contract address (must have WORKFLOW_ROLE granted to CRE forwarder)
	loanRegistryAddress: z.string(),
	// Chain selector name for the target network
	chainSelectorName: z.string(),
	// Gas limit for the registerLoan transaction
	gasLimit: z.string(),
})

type Config = z.infer<typeof configSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Covenant structure extracted by AI from the loan document.
 * All arrays are parallel (same index = same covenant).
 */
interface ExtractedLoanSchema {
	/** Reporting frequency in days (e.g. 30 for monthly) */
	reportingFrequencyDays: number
	/** Names of each covenant, e.g. "Maximum Leverage Ratio" */
	covenantNames: string[]
	/** Metric calculation formula, e.g. "Total Debt / EBITDA" */
	metricDefinitions: string[]
	/**
	 * Threshold values as decimals, e.g. 4.5 (will be scaled ×1e18 before onchain storage).
	 * For percentage-based covenants use decimal form: 1.25 = 125%
	 */
	thresholds: number[]
	/** "MAX" if the metric must stay below threshold, "MIN" if it must stay above */
	thresholdTypes: string[]
	/** EBITDA add-backs / exclusions; use "" if none */
	ebitdaAdjustments: string[]
}

/**
 * JSON body sent to the HTTP trigger endpoint when a loan document is uploaded.
 */
interface LoanDocumentPayload {
	/** Full text of the loan agreement document */
	document: string
	/** ERC-20 token address representing the tokenised loan */
	tokenAddress: string
	/**
	 * Principal amount as a uint256 string, already scaled by 1e18.
	 * Example: 5,000,000 tokens → "5000000000000000000000000"
	 */
	principalAmountWei: string
}

// ─────────────────────────────────────────────────────────────────────────────
// AI system prompt
// ─────────────────────────────────────────────────────────────────────────────

const COVENANT_EXTRACTION_SYSTEM_PROMPT = `
You are a financial document analysis system specialised in extracting loan covenant data.

Given a loan agreement document, extract every financial covenant and return them as a JSON object.

OUTPUT FORMAT (CRITICAL):
- Respond ONLY with a single valid JSON object — no markdown, no code fences, no prose.
- Use this exact structure:

{
  "reportingFrequencyDays": <integer, e.g. 30>,
  "covenantNames":       ["name1", "name2"],
  "metricDefinitions":   ["formula1", "formula2"],
  "thresholds":          [<decimal>, <decimal>],
  "thresholdTypes":      ["MAX" or "MIN", ...],
  "ebitdaAdjustments":  ["adjustment or empty string", ...]
}

RULES:
- All five arrays must have identical length (one entry per covenant).
- thresholds are plain decimal numbers representing the covenant limit, e.g.:
    4.5  →  4.5× leverage ratio
    1.25 →  1.25× coverage ratio (i.e. 125 %)
- thresholdTypes must be exactly "MAX" (metric must stay ≤ threshold)
  or "MIN" (metric must stay ≥ threshold).
- ebitdaAdjustments: describe bespoke add-backs/exclusions; use "" if none.
- reportingFrequencyDays: default to 30 if not specified.
- Extract ALL financial covenants: leverage, interest coverage, liquidity, capex, etc.
- Do not invent covenants not present in the document.
`.trim()

// ─────────────────────────────────────────────────────────────────────────────
// AI request builders (run inside each CRE node)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a request function for the Anthropic Claude Messages API.
 * Each CRE node calls this independently; results are consensus-checked.
 */
const buildClaudeRequest =
	(document: string, apiKey: string) =>
	(sendRequester: HTTPSendRequester, config: Config): ExtractedLoanSchema => {
		const requestBody = JSON.stringify({
			model: config.aiModel,
			max_tokens: 4096,
			temperature: 0,
			system: COVENANT_EXTRACTION_SYSTEM_PROMPT,
			messages: [
				{
					role: 'user',
					content: `Extract all financial covenants from the following loan document:\n\n${document}`,
				},
			],
		})

		const encodedBody = Buffer.from(new TextEncoder().encode(requestBody)).toString('base64')

		const resp = sendRequester
			.sendRequest({
				method: 'POST',
				url: 'https://api.anthropic.com/v1/messages',
				headers: {
					'content-type': 'application/json',
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
				},
				body: encodedBody,
				// Cache per-node to avoid redundant calls during consensus rounds
				cacheSettings: { store: true, maxAge: '300s' },
			})
			.result()

		if (!ok(resp)) {
			const bodyText = new TextDecoder().decode(resp.body)
			throw new Error(`Claude API error ${resp.statusCode}: ${bodyText}`)
		}

		const responseText = new TextDecoder().decode(resp.body)
		const claudeResp = JSON.parse(responseText)
		const content = claudeResp?.content?.[0]?.text

		if (!content) {
			throw new Error('Malformed Claude response: missing content[0].text')
		}

		return JSON.parse(content) as ExtractedLoanSchema
	}

/**
 * Builds a request function for the OpenAI Chat Completions API (GPT-4o etc.).
 * Each CRE node calls this independently; results are consensus-checked.
 */
const buildOpenAIRequest =
	(document: string, apiKey: string) =>
	(sendRequester: HTTPSendRequester, config: Config): ExtractedLoanSchema => {
		const requestBody = JSON.stringify({
			model: config.aiModel,
			temperature: 0,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: COVENANT_EXTRACTION_SYSTEM_PROMPT },
				{
					role: 'user',
					content: `Extract all financial covenants from the following loan document:\n\n${document}`,
				},
			],
		})

		const encodedBody = Buffer.from(new TextEncoder().encode(requestBody)).toString('base64')

		const resp = sendRequester
			.sendRequest({
				method: 'POST',
				url: 'https://api.openai.com/v1/chat/completions',
				headers: {
					'content-type': 'application/json',
					Authorization: `Bearer ${apiKey}`,
				},
				body: encodedBody,
				cacheSettings: { store: true, maxAge: '300s' },
			})
			.result()

		if (!ok(resp)) {
			const bodyText = new TextDecoder().decode(resp.body)
			throw new Error(`OpenAI API error ${resp.statusCode}: ${bodyText}`)
		}

		const responseText = new TextDecoder().decode(resp.body)
		const openAIResp = JSON.parse(responseText)
		const content = openAIResp?.choices?.[0]?.message?.content

		if (!content) {
			throw new Error('Malformed OpenAI response: missing choices[0].message.content')
		}

		return JSON.parse(content) as ExtractedLoanSchema
	}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP trigger handler
// ─────────────────────────────────────────────────────────────────────────────

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
	runtime.log('Covenant Sentinel — Loan Onboarding Workflow')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

	try {
		// ───────────────────────────────────────────────────────────────────────
		// Step 1: Parse incoming HTTP payload
		// ───────────────────────────────────────────────────────────────────────
		if (!payload.input || payload.input.length === 0) {
			throw new Error('Empty request payload — send JSON with document, tokenAddress, principalAmountWei')
		}

		const input = decodeJson(payload.input) as LoanDocumentPayload

		if (!input.document || input.document.trim().length === 0) {
			throw new Error('Field "document" is required: provide full loan agreement text')
		}
		if (!input.tokenAddress) {
			throw new Error('Field "tokenAddress" is required: provide the ERC-20 token address')
		}
		if (!input.principalAmountWei) {
			throw new Error('Field "principalAmountWei" is required: provide uint256 scaled by 1e18')
		}

		runtime.log(`[Step 1] Document received: ${input.document.length} chars`)
		runtime.log(`[Step 1] Token address: ${input.tokenAddress}`)
		runtime.log(`[Step 1] Principal (wei): ${input.principalAmountWei}`)

		// ───────────────────────────────────────────────────────────────────────
		// Step 2: Retrieve AI API key from the DON Vault via runtime.getSecret().
		// ───────────────────────────────────────────────────────────────────────
		const secretId = runtime.config.aiProvider === 'claude' ? 'CLAUDE_API_KEY' : 'OPENAI_API_KEY'
		const apiKey = runtime.getSecret({ id: secretId }).result().value

		runtime.log(`[Step 2] AI provider: ${runtime.config.aiProvider} / model: ${runtime.config.aiModel}`)

		// ───────────────────────────────────────────────────────────────────────
		// Step 3: Each CRE node independently calls the AI API (node mode).
		//         consensusIdenticalAggregation requires all nodes to produce
		//         the same JSON before the workflow proceeds.
		// ───────────────────────────────────────────────────────────────────────
		runtime.log('[Step 3] Extracting covenant schema via AI (running in node mode)...')

		const httpClient = new HTTPClient()

		const requestBuilder =
			runtime.config.aiProvider === 'claude'
				? buildClaudeRequest(input.document, apiKey)
				: buildOpenAIRequest(input.document, apiKey)

		const extractedSchema = httpClient
			.sendRequest(runtime, requestBuilder, consensusIdenticalAggregation<ExtractedLoanSchema>())(
				runtime.config,
			)
			.result()

		runtime.log(`[Step 3] AI consensus reached — ${extractedSchema.covenantNames.length} covenants extracted`)
		runtime.log(`[Step 3] Covenants: ${extractedSchema.covenantNames.join(', ')}`)

		// ───────────────────────────────────────────────────────────────────────
		// Validate extracted arrays
		// ───────────────────────────────────────────────────────────────────────
		const n = extractedSchema.covenantNames.length
		if (n === 0) {
			throw new Error('No covenants extracted — check document content and AI prompt')
		}
		if (
			extractedSchema.metricDefinitions.length !== n ||
			extractedSchema.thresholds.length !== n ||
			extractedSchema.thresholdTypes.length !== n ||
			extractedSchema.ebitdaAdjustments.length !== n
		) {
			throw new Error('AI returned inconsistent covenant array lengths')
		}

		// ───────────────────────────────────────────────────────────────────────
		// Step 4: Derive loan ID and prepare onchain parameters
		// ───────────────────────────────────────────────────────────────────────
		// Loan ID = keccak256(tokenAddress + first 512 chars of document)
		// This ensures the same document always maps to the same loanId.
		const loanId = keccak256(
			toBytes(`${input.tokenAddress.toLowerCase()}:${input.document.slice(0, 512)}`),
		)

		runtime.log(`[Step 4] Loan ID (bytes32): ${loanId}`)

		// Scale thresholds from decimal to uint256 (×1e18)
		// e.g. 4.5 → 4500000000000000000n
		const scaledThresholds = extractedSchema.thresholds.map((t) => BigInt(Math.round(t * 1e18)))

		// Reporting frequency in seconds
		const reportingFrequencySecs = BigInt(
			(extractedSchema.reportingFrequencyDays || 30) * 24 * 60 * 60,
		)

		const principalWei = BigInt(input.principalAmountWei)

		// ───────────────────────────────────────────────────────────────────────
		// Step 5: ABI-encode the loan registration parameters
		//
		// LoanRegistry implements IReceiverTemplate: writeReport() calls
		//   onReport(bytes metadata, bytes report)
		// where `report` is abi.decode'd inside the contract to extract the
		// loan fields. We use encodeAbiParameters (no 4-byte selector) because
		// registerLoan is an internal function — not a public dispatcher.
		// ───────────────────────────────────────────────────────────────────────
		runtime.log('[Step 5] ABI-encoding loan registration parameters for onReport...')

		const callData = encodeAbiParameters(
			parseAbiParameters(
				'bytes32, address, uint256, uint256, string[], string[], uint256[], string[], string[]',
			),
			[
				loanId as `0x${string}`,
				input.tokenAddress as Address,
				principalWei,
				reportingFrequencySecs,
				extractedSchema.covenantNames,
				extractedSchema.metricDefinitions,
				scaledThresholds,
				extractedSchema.thresholdTypes,
				extractedSchema.ebitdaAdjustments,
			],
		)

		// ───────────────────────────────────────────────────────────────────────
		// Step 6: Generate a consensus-signed CRE report
		// ───────────────────────────────────────────────────────────────────────
		runtime.log('[Step 6] Generating signed consensus report...')

		const reportResponse = runtime
			.report({
				encodedPayload: hexToBase64(callData),
				encoderName: 'evm',
				signingAlgo: 'ecdsa',
				hashingAlgo: 'keccak256',
			})
			.result()

		// ───────────────────────────────────────────────────────────────────────
		// Step 7: Submit report to LoanRegistry via EVMClient
		// ───────────────────────────────────────────────────────────────────────
		runtime.log('[Step 7] Writing covenant schema to LoanRegistry onchain...')
		runtime.log(`[Step 7] Contract: ${runtime.config.loanRegistryAddress}`)
		runtime.log(`[Step 7] Chain: ${runtime.config.chainSelectorName}`)

		const network = getNetwork({
			chainFamily: 'evm',
			chainSelectorName: runtime.config.chainSelectorName,
			isTestnet: true,
		})

		if (!network) {
			throw new Error(`Unknown chain selector name: ${runtime.config.chainSelectorName}`)
		}

		const evmClient = new EVMClient(network.chainSelector.selector)

		const writeResult = evmClient
			.writeReport(runtime, {
				receiver: runtime.config.loanRegistryAddress,
				report: reportResponse,
				gasConfig: {
					gasLimit: runtime.config.gasLimit,
				},
			})
			.result()

		if (writeResult.txStatus !== TxStatus.SUCCESS) {
			throw new Error(
				`LoanRegistry write failed (${writeResult.txStatus}): ${writeResult.errorMessage ?? 'unknown error'}`,
			)
		}

		const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32))
		runtime.log(`[Step 7] Transaction confirmed: ${txHash}`)

		// ───────────────────────────────────────────────────────────────────────
		// Step 8: Return confirmation JSON
		// ───────────────────────────────────────────────────────────────────────
		const confirmation = JSON.stringify({
			loanId,
			tokenAddress: input.tokenAddress,
			txHash,
			covenantCount: n,
			covenants: extractedSchema.covenantNames.map((name, i) => ({
				name,
				metricDefinition: extractedSchema.metricDefinitions[i],
				threshold: extractedSchema.thresholds[i],
				thresholdType: extractedSchema.thresholdTypes[i],
				ebitdaAdjustments: extractedSchema.ebitdaAdjustments[i] || null,
			})),
		})

		runtime.log('[Step 8] Loan onboarding complete')
		runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

		return confirmation
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		runtime.log(`[ERROR] ${msg}`)
		runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
		throw err
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow initialisation
// ─────────────────────────────────────────────────────────────────────────────

const initWorkflow = (config: Config) => {
	const httpTrigger = new HTTPCapability()
	return [
		handler(
			httpTrigger.trigger({}),
			onHttpTrigger,
		),
	]
}

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}
