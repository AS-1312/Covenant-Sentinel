/**
 * Covenant Sentinel — Continuous Monitoring Workflow
 *
 * Flow:
 *   Cron Trigger (scheduled periodic run, e.g. daily at midnight UTC)
 *   ↓
 *   Step 1 — Derive the current reporting quarter from config.reportingDate
 *             (or live UTC date if reportingDate is empty)
 *   ↓
 *   Step 2 — EVMClient.read() → LoanRegistry.getCovenantNames(loanId)
 *   ↓
 *   Step 3 — EVMClient.read() × N → LoanRegistry.getCovenant(loanId, name)
 *             for each covenant name (builds CovenantSchema array)
 *   ↓
 *   Step 4 — HTTPClient.sendRequest (node mode, consensusIdenticalAggregation):
 *             each CRE node independently fetches borrower financials from the
 *             fund-admin REST API and calls the AI model for covenant evaluation.
 *             All nodes must produce identical CovenantEvaluation JSON.
 *   ↓
 *   Step 5 — EVMClient.writeReport() → LoanHealthFeed.publishHealthReport(input)
 *   ↓
 *   Step 6 — Return JSON summary
 *
 * Prerequisites:
 *   - LoanRegistry must have the target loan registered (run loan-onboarding first).
 *   - LoanHealthFeed must implement IReceiver and grant WORKFLOW_ROLE to the
 *     CRE forwarder address.
 *   - Set CLAUDE_API_KEY or OPENAI_API_KEY in secrets.yaml.
 *   - Set CRE_ETH_PRIVATE_KEY in .env.
 */

import {
	bytesToHex,
	consensusIdenticalAggregation,
	handler,
	hexToBase64,
	CronCapability,
	HTTPClient,
	EVMClient,
	getNetwork,
	type CronPayload,
	type HTTPSendRequester,
	type Runtime,
	Runner,
	TxStatus,
	ok,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult } from 'viem'
import { z } from 'zod'
import { LoanRegistryAbi, LoanHealthFeedAbi } from '../contracts/abi'

// ─────────────────────────────────────────────────────────────────────────────
// Config schema
// ─────────────────────────────────────────────────────────────────────────────

const configSchema = z.object({
	// Cron schedule expression, e.g. "0 0 * * *" for daily at midnight UTC
	cronExpression: z.string(),
	// Optional ISO date string override for the reporting quarter (e.g. "2026-07-15").
	// Quarter is derived from the UTC month: Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec.
	// Leave empty ("") to use the live UTC date at execution time.
	reportingDate: z.string().default(''),
	// Loan ID (bytes32 hex) registered in LoanRegistry
	loanId: z.string(),
	// Base URL of the fund-admin financial API (no trailing slash)
	financialApiUrl: z.string(),
	// Deployed LoanRegistry contract address
	loanRegistryAddress: z.string(),
	// Deployed LoanHealthFeed contract address (must implement IReceiver)
	loanHealthFeedAddress: z.string(),
	// Chain selector name for the target network
	chainSelectorName: z.string(),
	// Gas limit for the publishHealthReport transaction
	gasLimit: z.string(),
	// AI provider: 'claude' uses Anthropic API, 'openai' uses OpenAI API
	aiProvider: z.enum(['claude', 'openai']),
	// Model name, e.g. 'claude-haiku-4-5-20251001' or 'gpt-4o'
	aiModel: z.string(),
	// FOR LOCAL SIMULATION ONLY: set the API key directly in config.
	// runtime.getSecret() only works on deployed DON nodes, not in the simulator.
	// Leave empty string ("") for production — the workflow uses runtime.getSecret() instead.
	aiApiKey: z.string().default(''),
})

type Config = z.infer<typeof configSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** What the AI returns per evaluation run */
interface CovenantEvaluation {
	covenantEvaluations: {
		covenantName: string
		/** Actual computed metric value, e.g. 3.42 (raw decimal) */
		calculatedValue: number
		status: 'PASS' | 'WARNING' | 'BREACH'
		trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING'
		/** 0–100 */
		confidenceScore: number
		notes: string
	}[]
	overallStatus: 'PASS' | 'WARNING' | 'BREACH'
	overallTrend: 'IMPROVING' | 'STABLE' | 'DETERIORATING'
	overallConfidenceScore: number
	riskNarrative: string
}

/** Covenant data pulled from LoanRegistry (threshold descaled from 1e18) */
interface CovenantSchema {
	name: string
	metricDefinition: string
	/** Threshold as plain decimal, e.g. 4.5 for a 4.5× leverage limit */
	threshold: number
	thresholdType: 'MAX' | 'MIN'
	ebitdaAdjustments: string
}

/** Financial metrics from the fund-admin API */
interface BorrowerFinancials {
	quarter: string
	year: number
	metrics: Record<string, number>
}

// ─────────────────────────────────────────────────────────────────────────────
// Enum mappings  (must match LoanHealthFeed.sol enum ordinals)
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_MAP = { PASS: 0, WARNING: 1, BREACH: 2 } as const
const TREND_MAP = { IMPROVING: 0, STABLE: 1, DETERIORATING: 2 } as const

// ─────────────────────────────────────────────────────────────────────────────
// AI evaluation system prompt
// ─────────────────────────────────────────────────────────────────────────────

const COVENANT_EVALUATION_SYSTEM_PROMPT = `
You are a financial covenant evaluation system for commercial real estate loan monitoring.

Given borrower financial metrics and a set of financial covenant schemas, evaluate each covenant and return a structured JSON assessment.

OUTPUT FORMAT (CRITICAL):
- Respond ONLY with a single valid JSON object — no markdown, no code fences, no prose.
- Use this exact structure:

{
  "covenantEvaluations": [
    {
      "covenantName": "<string — exact covenant name>",
      "calculatedValue": <number — computed metric value, e.g. 3.42>,
      "status": "PASS" | "WARNING" | "BREACH",
      "trend": "IMPROVING" | "STABLE" | "DETERIORATING",
      "confidenceScore": <integer 0-100>,
      "notes": "<string — brief explanation>"
    }
  ],
  "overallStatus": "PASS" | "WARNING" | "BREACH",
  "overallTrend": "IMPROVING" | "STABLE" | "DETERIORATING",
  "overallConfidenceScore": <integer 0-100>,
  "riskNarrative": "<string — paragraph summarising overall credit risk>"
}

EVALUATION RULES:
- For each covenant, use the metricDefinition formula to compute the metric value from the financial metrics provided.
- Status determination:
    - "MAX" thresholdType: BREACH if calculatedValue > threshold; WARNING if (threshold × 0.9) ≤ calculatedValue ≤ threshold; PASS if calculatedValue < (threshold × 0.9).
    - "MIN" thresholdType: BREACH if calculatedValue < threshold; WARNING if threshold ≤ calculatedValue ≤ (threshold × 1.1); PASS if calculatedValue > (threshold × 1.1).
- Trend: IMPROVING if the metric is moving away from a breach scenario; DETERIORATING if approaching breach; STABLE otherwise.
- confidenceScore: 100 if all required metrics are available and the formula is unambiguous; reduce proportionally for missing data or ambiguous formulas.
- overallStatus: worst status across all covenants (BREACH > WARNING > PASS).
- overallTrend: worst trend across all covenants (DETERIORATING > STABLE > IMPROVING).
- overallConfidenceScore: minimum confidence score across all covenants.
- riskNarrative: one concise paragraph summarising the borrower's overall covenant compliance.
`.trim()

// ─────────────────────────────────────────────────────────────────────────────
// AI helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildEvaluationPrompt(
	financials: BorrowerFinancials,
	covenantSchemas: CovenantSchema[],
): string {
	const schemasText = covenantSchemas
		.map(
			(c, i) =>
				`${i + 1}. ${c.name}\n` +
				`   Formula: ${c.metricDefinition}\n` +
				`   Threshold: ${c.threshold} (${c.thresholdType})\n` +
				`   EBITDA Adjustments: ${c.ebitdaAdjustments || 'None'}`,
		)
		.join('\n')

	const metricsText = Object.entries(financials.metrics)
		.map(([k, v]) => `  ${k}: ${v}`)
		.join('\n')

	return (
		`Evaluate the following financial covenants for ${financials.quarter} ${financials.year}.\n\n` +
		`COVENANT SCHEMAS:\n${schemasText}\n\n` +
		`BORROWER FINANCIAL METRICS:\n${metricsText}\n\n` +
		`Evaluate each covenant using the formula and financial metrics above. ` +
		`Return strictly typed JSON matching the required format.`
	)
}

function callClaude(
	sendRequester: HTTPSendRequester,
	config: Config,
	userPrompt: string,
	apiKey: string,
): CovenantEvaluation {
	const requestBody = JSON.stringify({
		model: config.aiModel,
		max_tokens: 4096,
		temperature: 0,
		system: COVENANT_EVALUATION_SYSTEM_PROMPT,
		messages: [{ role: 'user', content: userPrompt }],
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

	return JSON.parse(content) as CovenantEvaluation
}

function callOpenAI(
	sendRequester: HTTPSendRequester,
	config: Config,
	userPrompt: string,
	apiKey: string,
): CovenantEvaluation {
	const requestBody = JSON.stringify({
		model: config.aiModel,
		temperature: 0,
		response_format: { type: 'json_object' },
		messages: [
			{ role: 'system', content: COVENANT_EVALUATION_SYSTEM_PROMPT },
			{ role: 'user', content: userPrompt },
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

	return JSON.parse(content) as CovenantEvaluation
}

/**
 * Node-mode request function: each CRE node independently fetches borrower
 * financials and runs AI evaluation. consensusIdenticalAggregation requires
 * all nodes to produce identical CovenantEvaluation JSON before proceeding.
 */
const buildAIRequest =
	(quarter: string, covenantSchemas: CovenantSchema[], apiKey: string) =>
	(sendRequester: HTTPSendRequester, config: Config): CovenantEvaluation => {
		// ── 1. Fetch borrower financials from fund-admin API ──────────────────────
		const financialsResp = sendRequester
			.sendRequest({
				method: 'GET',
				url: `${config.financialApiUrl}/api/borrower-financials/${quarter}`,
				headers: { accept: 'application/json' },
				body: '',
				cacheSettings: { store: true, maxAge: '300s' },
			})
			.result()

		if (!ok(financialsResp)) {
			const bodyText = new TextDecoder().decode(financialsResp.body)
			throw new Error(`Financial API error ${financialsResp.statusCode}: ${bodyText}`)
		}

		const financials = JSON.parse(
			new TextDecoder().decode(financialsResp.body),
		) as BorrowerFinancials

		// ── 2. Build prompt and call AI provider ─────────────────────────────────
		const userPrompt = buildEvaluationPrompt(financials, covenantSchemas)

		if (config.aiProvider === 'claude') {
			return callClaude(sendRequester, config, userPrompt, apiKey)
		}

		return callOpenAI(sendRequester, config, userPrompt, apiKey)
	}

// ─────────────────────────────────────────────────────────────────────────────
// Cron trigger handler
// ─────────────────────────────────────────────────────────────────────────────

const onCronTrigger = (runtime: Runtime<Config>, _payload: CronPayload): string => {
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
	runtime.log('Covenant Sentinel — Continuous Monitoring Workflow')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

	try {
		const config = runtime.config

		// ── Step 1: Derive reporting quarter ──────────────────────────────────────
		const referenceDate = config.reportingDate ? new Date(config.reportingDate) : new Date()
		const month = referenceDate.getUTCMonth() + 1 // 1–12
		const quarter = Math.ceil(month / 3) // 1–4
		const quarterLabel = `Q${quarter}`

		runtime.log(`[Step 1] Reporting date: ${config.reportingDate || 'live (UTC now)'}`)
		runtime.log(`[Step 1] Quarter derived: ${quarterLabel} (month ${month})`)

		// ── Step 2: Read covenant names from LoanRegistry ─────────────────────────
		runtime.log('[Step 2] Reading covenant names from LoanRegistry...')
		runtime.log(`[Step 2] Loan ID: ${config.loanId}`)
		runtime.log(`[Step 2] Chain: ${config.chainSelectorName}`)

		const network = getNetwork({
			chainFamily: 'evm',
			chainSelectorName: config.chainSelectorName,
			isTestnet: true,
		})

		if (!network) {
			throw new Error(`Unknown chain selector name: ${config.chainSelectorName}`)
		}

		const evmClient = new EVMClient(network.chainSelector.selector)

		const namesCallData = encodeFunctionData({
			abi: LoanRegistryAbi,
			functionName: 'getCovenantNames',
			args: [config.loanId as `0x${string}`],
		})

		const namesResult = evmClient
			.callContract(runtime, {
				call: {
					to: hexToBase64(config.loanRegistryAddress),
					data: hexToBase64(namesCallData),
				},
			})
			.result()

		// Single unnamed output → decodeFunctionResult returns string[] directly.
		// Cast to string[] since the ABI is not const-typed.
		const covenantNames = decodeFunctionResult({
			abi: LoanRegistryAbi,
			functionName: 'getCovenantNames',
			data: bytesToHex(namesResult.data),
		}) as readonly string[]

		runtime.log(`[Step 2] Found ${covenantNames.length} covenants: ${covenantNames.join(', ')}`)

		if (covenantNames.length === 0) {
			throw new Error('No covenants found for loan — verify loanId and LoanRegistry registration')
		}

		// ── Step 3: Read each covenant schema ─────────────────────────────────────
		runtime.log('[Step 3] Reading covenant schemas from LoanRegistry...')

		const covenantSchemas: CovenantSchema[] = covenantNames.map((name) => {
			const covCallData = encodeFunctionData({
				abi: LoanRegistryAbi,
				functionName: 'getCovenant',
				args: [config.loanId as `0x${string}`, name],
			})

			const covResult = evmClient
				.callContract(runtime, {
					call: {
						to: hexToBase64(config.loanRegistryAddress),
						data: hexToBase64(covCallData),
					},
				})
				.result()

			// 6 named outputs → cast to tuple since ABI is not const-typed
			const [covName, metricDef, threshold, thresholdType, ebitdaAdj] = decodeFunctionResult({
				abi: LoanRegistryAbi,
				functionName: 'getCovenant',
				data: bytesToHex(covResult.data),
			}) as [string, string, bigint, string, string, boolean]

			return {
				name: covName as string,
				metricDefinition: metricDef as string,
				// threshold is stored scaled ×1e18 onchain; descale to decimal
				threshold: Number(threshold as bigint) / 1e18,
				thresholdType: thresholdType as 'MAX' | 'MIN',
				ebitdaAdjustments: ebitdaAdj as string,
			}
		})

		runtime.log(`[Step 3] Loaded ${covenantSchemas.length} covenant schemas`)
		for (const s of covenantSchemas) {
			runtime.log(`[Step 3]   ${s.name}: ${s.thresholdType} ${s.threshold} | ${s.metricDefinition}`)
		}

		// ── Step 4: AI covenant evaluation (node mode) ────────────────────────────
		runtime.log('[Step 4] Running AI covenant evaluation (node mode)...')
		runtime.log(`[Step 4] Provider: ${config.aiProvider} / Model: ${config.aiModel}`)

		const secretId = config.aiProvider === 'claude' ? 'CLAUDE_API_KEY' : 'OPENAI_API_KEY'
		const secret = runtime.getSecret({ id: secretId }).result()
		const apiKey = secret.value

		const httpClient = new HTTPClient()

		const evaluation = httpClient
			.sendRequest(
				runtime,
				buildAIRequest(quarterLabel, covenantSchemas, apiKey),
				consensusIdenticalAggregation<CovenantEvaluation>(),
			)(config)
			.result()

		runtime.log(`[Step 4] Consensus reached — overall status: ${evaluation.overallStatus}`)
		runtime.log(`[Step 4] Evaluations: ${evaluation.covenantEvaluations.length} covenants`)

		for (const ce of evaluation.covenantEvaluations) {
			runtime.log(
				`[Step 4]   ${ce.covenantName}: ${ce.status} (value=${ce.calculatedValue}, confidence=${ce.confidenceScore}%)`,
			)
		}

		// ── Step 5: Publish health report to LoanHealthFeed ───────────────────────
		runtime.log('[Step 5] Publishing health report to LoanHealthFeed...')
		runtime.log(`[Step 5] Contract: ${config.loanHealthFeedAddress}`)

		const callData = encodeFunctionData({
			abi: LoanHealthFeedAbi,
			functionName: 'publishHealthReport',
			args: [
				{
					loanId: config.loanId as `0x${string}`,
					overallStatus: STATUS_MAP[evaluation.overallStatus],
					overallTrend: TREND_MAP[evaluation.overallTrend],
					overallConfidenceScore: BigInt(evaluation.overallConfidenceScore),
					riskNarrative: evaluation.riskNarrative,
					covenantNames: evaluation.covenantEvaluations.map((c) => c.covenantName),
					statuses: evaluation.covenantEvaluations.map((c) => STATUS_MAP[c.status]),
					calculatedValues: evaluation.covenantEvaluations.map((c) =>
						BigInt(Math.round(c.calculatedValue * 1e18)),
					),
					thresholds: covenantSchemas.map((s) => BigInt(Math.round(s.threshold * 1e18))),
					confidenceScores: evaluation.covenantEvaluations.map((c) =>
						BigInt(c.confidenceScore),
					),
					trends: evaluation.covenantEvaluations.map((c) => TREND_MAP[c.trend]),
					notes: evaluation.covenantEvaluations.map((c) => c.notes),
				},
			],
		})

		const reportResponse = runtime
			.report({
				encodedPayload: hexToBase64(callData),
				encoderName: 'evm',
				signingAlgo: 'ecdsa',
				hashingAlgo: 'keccak256',
			})
			.result()

		const writeResult = evmClient
			.writeReport(runtime, {
				receiver: config.loanHealthFeedAddress,
				report: reportResponse,
				gasConfig: { gasLimit: config.gasLimit },
			})
			.result()

		if (writeResult.txStatus !== TxStatus.SUCCESS) {
			throw new Error(
				`LoanHealthFeed write failed (${writeResult.txStatus}): ${writeResult.errorMessage ?? 'unknown error'}`,
			)
		}

		const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32))
		runtime.log(`[Step 5] Transaction confirmed: ${txHash}`)

		// ── Step 6: Return summary JSON ────────────────────────────────────────────
		const summary = JSON.stringify({
			loanId: config.loanId,
			quarter: quarterLabel,
			txHash,
			overallStatus: evaluation.overallStatus,
			overallTrend: evaluation.overallTrend,
			overallConfidenceScore: evaluation.overallConfidenceScore,
			riskNarrative: evaluation.riskNarrative,
			covenantEvaluations: evaluation.covenantEvaluations,
		})

		runtime.log('[Step 6] Continuous monitoring cycle complete')
		runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

		return summary
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
	const cronTrigger = new CronCapability()
	return [
		handler(
			cronTrigger.trigger({ schedule: config.cronExpression }),
			onCronTrigger,
		),
	]
}

export async function main() {
	// Two-type-parameter form: TIntermediateConfig carries Zod's input type (fields with
	// `.default()` are optional), while TConfig = Config carries the output type (all required).
	const runner = await Runner.newRunner<Config, z.input<typeof configSchema>>({ configSchema })
	await runner.run(initWorkflow)
}
