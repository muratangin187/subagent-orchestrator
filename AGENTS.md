# Standalone Agent Orchestrator
This is an independent local developer tool, not a Madlen service or a T3 extension.
Use Node 22.16+ and npm. Run npm run check, npm test, and npm run build before delivery.
Keep transport, persistence, orchestration, and providers separate. No T3 runtime imports.
Never replay an uncertain provider side effect automatically. Keep published run results immutable.
Do not log secrets or full inherited environments. Live tests use temporary workspaces and short prompts.
Do not change global MCP configuration or publish packages without a user request.
