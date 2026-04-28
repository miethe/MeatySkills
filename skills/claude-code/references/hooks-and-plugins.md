# Hooks and Plugins

Customize and extend Claude Code behavior with hooks and plugins.

## Hooks System

Hooks are shell commands that execute in response to events.

### Hook Types

**PreToolUse**: Execute before tool calls
**PostToolUse**: Execute after tool calls
**PermissionRequest**: Execute when permission dialogs appear
**UserPromptSubmit**: Execute when user submits prompts
**SessionStart**: Execute when session starts
**SessionEnd**: Execute when session ends
**Stop**: Execute when main agent finishes
**SubagentStart**: Execute when subagent starts
**SubagentStop**: Execute when subagent completes
**PreCompact**: Execute before context compaction
**Notification**: Execute on system notifications

### Configuration

Hooks are configured in `.claude/settings.json` under the `hooks` key:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Running bash command...'"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "FILE_PATH=$(echo \"$TOOL_ARGS\" | jq -r '.file_path // empty') && echo \"Modified: $FILE_PATH\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "./scripts/validate-request.sh"
          }
        ]
      }
    ]
  }
}
```

### Matcher Syntax

**Tool-based events** (PreToolUse, PostToolUse, PermissionRequest) support matchers:

- **Exact match**: `"Write"` - matches only Write tool
- **Regex pattern**: `"Write|Edit"` - matches Write OR Edit
- **Wildcard**: `"*"` - matches all tools
- **No matcher**: Omit field or use `""` for events without tool filtering

**Session events** (SessionStart, SessionEnd, UserPromptSubmit, etc.) do not use matchers.

### Environment Variables

Available in hook scripts:

**All hooks:**
- `$TOOL_NAME`: Name of the tool being called (for tool-based hooks)
- `$TOOL_ARGS`: JSON string of tool arguments
- `$CLAUDE_PROJECT_DIR`: Absolute path to project root
- `$CLAUDE_PLUGIN_ROOT`: Plugin directory (for plugin hooks)

**Post-tool only:**
- `$TOOL_RESULT`: Tool execution result

**SessionStart only:**
- `$CLAUDE_ENV_FILE`: Path for persisting environment variables

### Hook Examples

#### PreToolUse: Security Validation
```bash
#!/bin/bash
# .claude/scripts/validate-bash.sh

# Block dangerous commands
if echo "$TOOL_ARGS" | grep -E "rm -rf /|format|mkfs"; then
  echo "❌ Dangerous command blocked" >&2
  exit 2  # Exit code 2 = blocking error
fi

echo "✓ Command validated"
exit 0
```

**Configuration:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./.claude/scripts/validate-bash.sh"
          }
        ]
      }
    ]
  }
}
```

#### PostToolUse: Auto-format
```bash
#!/bin/bash
# .claude/scripts/format-code.sh

# Extract file path from tool args
FILE_PATH=$(echo "$TOOL_ARGS" | jq -r '.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Format based on file type
case "$FILE_PATH" in
  *.js|*.ts|*.jsx|*.tsx)
    prettier --write "$FILE_PATH" 2>/dev/null
    ;;
  *.py)
    black "$FILE_PATH" 2>/dev/null
    ;;
  *.go)
    gofmt -w "$FILE_PATH" 2>/dev/null
    ;;
esac

exit 0
```

**Configuration:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "./.claude/scripts/format-code.sh"
          }
        ]
      }
    ]
  }
}
```

#### UserPromptSubmit: Cost Tracking
```bash
#!/bin/bash
# .claude/scripts/track-usage.sh

# Extract prompt from arguments (UserPromptSubmit receives different format)
PROMPT_TEXT="$TOOL_ARGS"

# Log prompt
echo "$(date): $PROMPT_TEXT" >> .claude/usage.log

# Estimate tokens (rough - ~0.75 tokens per word)
TOKEN_COUNT=$(echo "$PROMPT_TEXT" | wc -w | awk '{print int($1 * 0.75)}')
echo "Estimated tokens: $TOKEN_COUNT"

exit 0
```

**Configuration:**
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "./.claude/scripts/track-usage.sh"
          }
        ]
      }
    ]
  }
}
```

### Hook Decision Control

Hooks can return JSON to influence Claude's behavior:

```json
{
  "decision": "allow",
  "reason": "Validation passed",
  "continue": true
}
```

**Exit codes:**
- `0`: Success (stdout processed for JSON)
- `2`: Blocking error (stderr shown to Claude, operation blocked)
- Other: Non-blocking error (logged in verbose mode)

### Hook Best Practices

**Performance**: Keep hooks fast (<100ms) to avoid blocking operations
**Reliability**: Handle errors gracefully with proper exit codes
**Security**: Validate all inputs, especially from `$TOOL_ARGS`
**Logging**: Log important actions to `.claude/logs/` or project logs
**Testing**: Test hooks thoroughly with various tool arguments
**Error handling**: Use exit code 2 for blocking errors, 0 for success

### Hook Errors and Exit Codes

**Exit code behavior:**
- `0`: Hook succeeded - stdout is processed for optional JSON decision
- `2`: Blocking error - stderr shown to Claude, operation blocked (PreToolUse only)
- Other codes: Non-blocking error - logged but operation continues

**PreToolUse failures:**
- Exit code 2 blocks the tool execution
- Error message from stderr shown to Claude
- Used for validation and security checks

**PostToolUse failures:**
- Failures are logged but don't block subsequent operations
- Useful for non-critical tasks like formatting or linting

**UserPromptSubmit failures:**
- Can block prompt processing with exit code 2
- Useful for request validation or cost controls

## Plugins System

Plugins are packaged collections of extensions.

### Plugin Structure

```
my-plugin/
├── plugin.json          # Plugin metadata
├── commands/            # Slash commands
│   ├── my-command.md
│   └── another-command.md
├── skills/             # Agent skills
│   └── my-skill/
│       ├── skill.md
│       └── skill.json
├── hooks/              # Hook scripts
│   ├── hooks.json
│   └── scripts/
├── mcp/                # MCP server configurations
│   └── mcp.json
└── README.md           # Documentation
```

### plugin.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Plugin description",
  "author": "Your Name",
  "homepage": "https://github.com/user/plugin",
  "license": "MIT",
  "commands": ["commands/*.md"],
  "skills": ["skills/*/"],
  "hooks": "hooks/hooks.json",
  "mcpServers": "mcp/mcp.json",
  "dependencies": {
    "node": ">=18.0.0"
  }
}
```

### Installing Plugins

#### From GitHub
```bash
claude plugin install gh:username/repo
claude plugin install gh:username/repo@v1.0.0
```

#### From npm
```bash
claude plugin install npm:package-name
claude plugin install npm:@scope/package-name
```

#### From Local Path
```bash
claude plugin install ./path/to/plugin
claude plugin install ~/plugins/my-plugin
```

#### From URL
```bash
claude plugin install https://example.com/plugin.zip
```

### Managing Plugins

#### List Installed Plugins
```bash
claude plugin list
```

#### Update Plugin
```bash
claude plugin update my-plugin
claude plugin update --all
```

#### Uninstall Plugin
```bash
claude plugin uninstall my-plugin
```

#### Enable/Disable Plugin
```bash
claude plugin disable my-plugin
claude plugin enable my-plugin
```

### Creating Plugins

#### Initialize Plugin
```bash
mkdir my-plugin
cd my-plugin
```

#### Create plugin.json
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My awesome plugin",
  "author": "Your Name",
  "commands": ["commands/*.md"],
  "skills": ["skills/*/"]
}
```

#### Add Components
```bash
# Add slash command
mkdir -p commands
cat > commands/my-command.md <<EOF
# My Command
Do something awesome with {{input}}.
EOF

# Add skill
mkdir -p skills/my-skill
cat > skills/my-skill/skill.json <<EOF
{
  "name": "my-skill",
  "description": "Does something",
  "version": "1.0.0"
}
EOF
```

#### Package Plugin
```bash
# Create archive
tar -czf my-plugin.tar.gz .

# Or zip
zip -r my-plugin.zip .
```

### Publishing Plugins

#### To GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git tag v1.0.0
git push origin main --tags
```

#### To npm
```bash
npm init
npm publish
```

### Plugin Marketplaces

Organizations can create private plugin marketplaces.

#### Configure Marketplace
```json
{
  "marketplaces": [
    {
      "name": "company-internal",
      "url": "https://plugins.company.com/catalog.json",
      "auth": {
        "type": "bearer",
        "token": "${COMPANY_PLUGIN_TOKEN}"
      }
    }
  ]
}
```

#### Marketplace Catalog Format
```json
{
  "plugins": [
    {
      "name": "company-plugin",
      "version": "1.0.0",
      "description": "Internal plugin",
      "downloadUrl": "https://plugins.company.com/company-plugin-1.0.0.zip",
      "checksum": "sha256:abc123..."
    }
  ]
}
```

#### Install from Marketplace
```bash
claude plugin install company-internal:company-plugin
```

## Example Plugin: Code Quality

### Structure
```
code-quality-plugin/
├── plugin.json
├── commands/
│   ├── lint.md
│   └── format.md
├── skills/
│   └── code-review/
│       ├── skill.md
│       └── skill.json
└── hooks/
    ├── hooks.json
    └── scripts/
        └── auto-lint.sh
```

### plugin.json
```json
{
  "name": "code-quality",
  "version": "1.0.0",
  "description": "Code quality tools and automation",
  "commands": ["commands/*.md"],
  "skills": ["skills/*/"],
  "hooks": "hooks/hooks.json"
}
```

### commands/lint.md
```markdown
# Lint

Run linter on {{files}} and fix all issues automatically.
```

### hooks/hooks.json
```json
{
  "hooks": {
    "post-tool": {
      "write": "./scripts/auto-lint.sh"
    }
  }
}
```

## Security Considerations

### Hook Security
- Validate all inputs
- Use whitelists for allowed commands
- Implement timeouts
- Log all executions
- Review hook scripts regularly

### Plugin Security
- Verify plugin sources
- Review code before installation
- Use signed packages when available
- Monitor plugin behavior
- Keep plugins updated

### Best Practices
- Install plugins from trusted sources only
- Review plugin permissions
- Use plugin sandboxing when available
- Monitor resource usage
- Regular security audits

## Troubleshooting

### Hooks Not Running
- Check hooks.json syntax
- Verify script permissions (`chmod +x`)
- Check script paths
- Review logs in `.claude/logs/`

### Plugin Installation Failures
- Verify internet connectivity
- Check plugin URL/path
- Review error messages
- Clear cache: `claude plugin cache clear`

### Plugin Conflicts
- Check for conflicting commands
- Review plugin load order
- Disable conflicting plugins
- Update plugins to compatible versions

## See Also

- Creating slash commands: `references/slash-commands.md`
- Agent skills: `references/agent-skills.md`
- Configuration: `references/configuration.md`
- Best practices: `references/best-practices.md`
