# Integration: Playwright MCP and Chrome DevTools MCP

## Use MCP when

- the agent needs to inspect the UI live
- selectors are unknown
- accessibility tree helps locate controls
- the app behaves differently at runtime
- console/network/performance data is needed

## Convert exploration into code

MCP exploration is not the final artifact. Once the agent discovers the flow, convert it into a deterministic Playwright capture script.

## Default stance

- CLI/scripted Playwright for repeatable capture
- MCP for diagnosis and exploration
