cre workflow simulate ./loan-onboarding \
    --target staging-settings \
    --non-interactive \
    --trigger-index 0 \
    --http-payload @/home/alan/Projects/Covenant-Sentinel/cre-workflows/examples/sample-http-trigger-payload.json  --broadcast
