# Recorded model fallback

This v3 example uses local CLI lanes. Both task classes prefer GPT-6.2 Sol. GPT-6.1 Sol follows it only after the newer holder has a recorded refusal or unavailability with a reason, followed by a native route. The same rule applies to the executable fallback list. The router never requires a successful model probe to select the default.

A caller can pass a model-scoped observation to `resolve --capacity-file` and resolve again. For example, save this as `capacity.json` when a serving error has been recorded:

```json
{
  "models": {"gpt-6.2-sol": {"state": "unavailable", "reason": "model not found"}},
  "lanes": {"native": {"state": "unavailable", "reason": "executor unavailable"}}
}
```

From the router directory:

```sh
node resolve-cli.js resolve --task-class raw_strength --json \
  --registry registry/examples/recorded-fallback/model-registry.yaml \
  --capacity-file capacity.json
```

A model-scoped observation applies across the model's configured lanes. For a lane-wide outage use `lanes.<lane>` instead. Only an observation from an actual availability check or execution failure should feed a dispatcher. A missing configuration entry or a capability mismatch alone does not produce an availability receipt.

The example uses two synthetic lanes to demonstrate automatic account fallback: an unavailable primary lane selects the alternate and records the reason.

The neighboring generated JSON and routing table are derived from the example YAML. The router's default artifact and deployment recipe do not read this example.
