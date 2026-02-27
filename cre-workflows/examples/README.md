# Examples

End-to-end example showing input and expected output for the loan-onboarding workflow.

## Files

| File | Description |
|------|-------------|
| `sample-loan-document.md` | A realistic senior secured term loan agreement with 5 financial covenants |
| `sample-http-trigger-payload.json` | The JSON body to POST to the CRE HTTP trigger endpoint |
| `expected-ai-extraction.json` | The JSON the AI is expected to extract (what each CRE node should agree on) |

---

## How to test

### 1. Start simulation

```bash
cd cre-workflows
cre workflow simulate --workflow loan-onboarding --target staging-settings
```

### 2. Send the trigger payload

During simulation the CLI prints a local endpoint. POST the payload to it:

```bash
curl -X POST <local-endpoint> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -d @examples/sample-http-trigger-payload.json
```

Or replace the `"document"` field with the full text of `sample-loan-document.md`.

### 3. Verify extraction

The workflow logs will show the covenants extracted by the AI. Compare them against `expected-ai-extraction.json`.

---

## Payload field reference

```jsonc
{
  // Full text of the loan agreement (plain text or markdown)
  "document": "...",

  // ERC-20 token address for the tokenised loan position
  "tokenAddress": "0x...",

  // Principal in uint256 wei-like units (already scaled × 1e18).
  // Example: USD 50,000,000 → "50000000000000000000000000"
  "principalAmountWei": "50000000000000000000000000"
}
```

### principalAmountWei quick reference

| Human amount | principalAmountWei |
|---|---|
| USD 1,000,000 | `"1000000000000000000000000"` |
| USD 10,000,000 | `"10000000000000000000000000"` |
| USD 50,000,000 | `"50000000000000000000000000"` |
| USD 100,000,000 | `"100000000000000000000000000"` |

---

## What the workflow does with the extracted data

| Extracted field | Onchain transformation | LoanRegistry param |
|---|---|---|
| `reportingFrequencyDays` | `× 86400` → seconds | `reportingFrequency` |
| `thresholds[]` | `× 1e18` → uint256 (e.g. `4.5 → 4500000000000000000`) | `thresholds[]` |
| All string arrays | passed as-is | `covenantNames[]`, `metricDefinitions[]`, etc. |
| `tokenAddress` (from payload) | passed as-is | `tokenAddress` |
| `principalAmountWei` (from payload) | BigInt conversion | `principalAmount` |
| `loanId` | `keccak256(tokenAddress + doc[:512])` | `loanId` |
