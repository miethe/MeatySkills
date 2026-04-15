---
description: Validate layered architecture compliance (router→service→repository→DB)
allowed-tools: Read(./**), Grep, Glob, Bash(git:*), Bash(node:*), Bash(uv:*)
argument-hint: "[--component=backend|frontend|all] [--strict-mode] [--report-format=text|json] [--fix-suggestions]"
---

# Check Architecture Compliance

Validates project's layered architecture compliance, ensuring strict adherence to the router → service → repository → database pattern for backend, and proper component/hook separation for frontend.

## Context Analysis

Analyze current codebase architecture state:

```bash
# Source shared utilities
source .claude/scripts/architecture-utils.sh 2>/dev/null || echo "Warning: architecture-utils.sh not found"
source .claude/scripts/report-utils.sh 2>/dev/null || echo "Warning: report-utils.sh not found"
source .claude/scripts/validation-utils.sh 2>/dev/null || echo "Warning: validation-utils.sh not found"

# Initialize architecture compliance check
if type init_report >/dev/null 2>&1; then
    init_report "Architecture Compliance Check"
else
    echo "=== Architecture Compliance Check ==="
fi

# Architecture overview and component discovery
echo "=== Architecture Overview ==="

# Backend architecture analysis
if [[ -d "services/api" ]]; then
    echo "Backend service found: services/api"
    echo "Backend layers:"
    [[ -d "services/api/app/api" ]] && echo "  ✅ API/Router layer: app/api" || echo "  ❌ Missing API/Router layer"
    [[ -d "services/api/app/services" ]] && echo "  ✅ Service layer: app/services" || echo "  ❌ Missing Service layer"
    [[ -d "services/api/app/repositories" ]] && echo "  ✅ Repository layer: app/repositories" || echo "  ❌ Missing Repository layer"
    [[ -d "services/api/app/models" ]] && echo "  ✅ Model layer: app/models" || echo "  ❌ Missing Model layer"
else
    echo "No backend service found"
fi

# Frontend architecture analysis
echo -e "\nFrontend architecture:"
if [[ -d "apps/web" ]]; then
    echo "Web app found: apps/web"
    [[ -d "apps/web/src/app" ]] && echo "  ✅ App Router pages: src/app" || echo "  ❌ Missing App Router structure"
    [[ -d "apps/web/src/components" ]] && echo "  ✅ Components: src/components" || echo "  ❌ Missing components"
    [[ -d "apps/web/src/hooks" ]] && echo "  ✅ Hooks: src/hooks" || echo "  ❌ Missing hooks"
    [[ -d "apps/web/src/lib" ]] && echo "  ✅ Utilities: src/lib" || echo "  ❌ Missing lib/utilities"
fi

if [[ -d "packages/ui" ]]; then
    echo "UI package found: packages/ui"
    [[ -d "packages/ui/src/components" ]] && echo "  ✅ Shared components: packages/ui/src/components" || echo "  ❌ Missing shared components"
fi
```

## Parse Command Arguments

Handle command line parameters:

```bash
# Parse command line arguments
component="all"
strict_mode=false
report_format="text"
fix_suggestions=false

for arg in "$@"; do
    case "$arg" in
        --component=*)
            component="${arg#*=}"
            ;;
        --strict-mode)
            strict_mode=true
            ;;
        --report-format=*)
            report_format="${arg#*=}"
            ;;
        --fix-suggestions)
            fix_suggestions=true
            ;;
        --help)
            echo "Usage: check-architecture [options]"
            echo ""
            echo "Options:"
            echo "  --component=backend|frontend|all  Component to validate (default: all)"
            echo "  --strict-mode                     Enable stricter validation rules"
            echo "  --report-format=text|json         Output format (default: text)"
            echo "  --fix-suggestions                 Include suggestions for fixing violations"
            echo "  --help                            Show this help message"
            exit 0
            ;;
    esac
done

echo "Validation scope: $component"
echo "Strict mode: $strict_mode"
echo "Report format: $report_format"
```

## Backend Architecture Validation

Validate backend layer separation and dependencies:

```bash
if [[ "$component" == "backend" || "$component" == "all" ]]; then
    echo -e "\n=== Backend Architecture Validation ==="

    if [[ -d "services/api" ]]; then
        if type validate_backend_layers >/dev/null 2>&1; then
            echo "Using shared architecture validation utilities..."
            if validate_backend_layers "services/api/app" "$strict_mode"; then
                echo "✅ Backend architecture validation passed"
                backend_violations=0

                if type add_success >/dev/null 2>&1; then
                    add_success "Backend architecture compliance verified"
                fi
            else
                echo "❌ Backend architecture violations found"
                backend_violations=1

                if type add_error >/dev/null 2>&1; then
                    add_error "Backend architecture violations detected"
                fi
            fi
        else
            echo "⚠ Architecture validation utilities not available"
            echo "Performing basic validation..."

            # Fallback validation
            backend_violations=0
            api_dir="services/api/app"

            if [[ ! -d "$api_dir" ]]; then
                echo "❌ Backend API directory not found: $api_dir"
                backend_violations=1
            else
                echo "✓ Backend API directory exists"

                # Check basic layer structure
                required_layers=("api" "services" "repositories" "models")
                for layer in "${required_layers[@]}"; do
                    if [[ -d "$api_dir/$layer" ]]; then
                        echo "✓ $layer layer exists"
                    else
                        echo "❌ Missing $layer layer"
                        backend_violations=1
                    fi
                done

                # Basic dependency checks
                if [[ -d "$api_dir/api" ]]; then
                    echo "Checking router layer..."
                    router_files=$(find "$api_dir/api" -name "*.py" 2>/dev/null | head -5)
                    for file in $router_files; do
                        if [[ -f "$file" ]]; then
                            if grep -q "from.*repositories" "$file"; then
                                echo "❌ Direct repository import found in router: $(basename "$file")"
                                backend_violations=1
                            fi
                        fi
                    done
                fi
            fi
        fi
    else
        echo "⏭️ No backend service found, skipping backend validation"
        backend_violations=0
    fi
else
    echo "⏭️ Backend validation skipped (component=$component)"
    backend_violations=0
fi
```

## Frontend Architecture Validation

Validate frontend component architecture and patterns:

```bash
if [[ "$component" == "frontend" || "$component" == "all" ]]; then
    echo -e "\n=== Frontend Architecture Validation ==="

    if [[ -d "apps/web" ]]; then
        if type validate_frontend_architecture >/dev/null 2>&1; then
            echo "Using shared frontend validation utilities..."
            if validate_frontend_architecture "apps/web" "$strict_mode"; then
                echo "✅ Frontend architecture validation passed"
                frontend_violations=0

                if type add_success >/dev/null 2>&1; then
                    add_success "Frontend architecture compliance verified"
                fi
            else
                echo "❌ Frontend architecture violations found"
                frontend_violations=1

                if type add_error >/dev/null 2>&1; then
                    add_error "Frontend architecture violations detected"
                fi
            fi
        else
            echo "⚠ Frontend architecture validation utilities not available"
            echo "Performing basic validation..."

            # Fallback validation
            frontend_violations=0
            web_dir="apps/web"

            # Check Next.js App Router structure
            if [[ -d "$web_dir/src/app" ]]; then
                echo "✓ Next.js App Router structure present"
            else
                echo "❌ Missing Next.js App Router structure (src/app)"
                frontend_violations=1
            fi

            # Check for required directories
            required_dirs=("src/components" "src/hooks" "src/lib")
            for dir in "${required_dirs[@]}"; do
                if [[ -d "$web_dir/$dir" ]]; then
                    echo "✓ $dir exists"
                else
                    echo "❌ Missing directory: $dir"
                    frontend_violations=1
                fi
            done

            # Check for @miethe/ui usage
            if [[ -f "$web_dir/package.json" ]] && grep -q "@miethe/ui" "$web_dir/package.json"; then
                echo "✓ @miethe/ui dependency present"
            else
                echo "❌ @miethe/ui dependency missing"
                frontend_violations=1
            fi

            # Check for direct Radix imports (should use @miethe/ui)
            if [[ -d "$web_dir/src" ]]; then
                direct_radix=$(find "$web_dir/src" -name "*.tsx" -o -name "*.ts" | \
                    xargs grep -l "@radix-ui" 2>/dev/null | wc -l)
                if [[ $direct_radix -gt 0 ]]; then
                    echo "❌ Found $direct_radix files with direct Radix imports (should use @miethe/ui)"
                    frontend_violations=1
                else
                    echo "✓ No direct Radix imports found"
                fi
            fi
        fi
    else
        echo "⏭️ No frontend app found, skipping frontend validation"
        frontend_violations=0
    fi
else
    echo "⏭️ Frontend validation skipped (component=$component)"
    frontend_violations=0
fi
```

## UI Package Architecture

Validate shared UI package structure:

```bash
if [[ "$component" == "frontend" || "$component" == "all" ]]; then
    echo -e "\n=== UI Package Architecture ==="

    if [[ -d "packages/ui" ]]; then
        ui_violations=0

        # Check basic structure
        required_ui_dirs=("src/components" "stories")
        for dir in "${required_ui_dirs[@]}"; do
            if [[ -d "packages/ui/$dir" ]]; then
                echo "✓ UI package has $dir"
            else
                echo "❌ UI package missing $dir"
                ui_violations=1
            fi
        done

        # Check for Storybook configuration
        if [[ -f "packages/ui/.storybook/main.ts" || -f "packages/ui/.storybook/main.js" ]]; then
            echo "✓ Storybook configuration present"
        else
            echo "⚠ Storybook configuration not found"
        fi

        # Check package.json structure
        if type validate_package_json >/dev/null 2>&1; then
            if validate_package_json "packages/ui/package.json" "$strict_mode"; then
                echo "✓ UI package.json is valid"
            else
                echo "❌ UI package.json validation failed"
                ui_violations=1
            fi
        fi

        if [[ $ui_violations -eq 0 ]]; then
            echo "✅ UI package architecture is compliant"
        else
            echo "❌ UI package architecture violations found"
        fi
    else
        echo "⏭️ No UI package found"
        ui_violations=0
    fi
else
    ui_violations=0
fi
```

## Architecture Fix Suggestions

Provide suggestions for fixing violations:

```bash
if [[ "$fix_suggestions" == "true" ]]; then
    echo -e "\n=== Architecture Fix Suggestions ==="

    # Backend suggestions
    if [[ $backend_violations -gt 0 ]]; then
        echo "🔧 Backend Architecture Fixes:"

        if [[ ! -d "services/api/app" ]]; then
            echo "  • Create backend API directory structure:"
            echo "    mkdir -p services/api/app/{api,services,repositories,models}"
        fi

        if [[ -d "services/api/app/api" ]]; then
            router_issues=$(find services/api/app/api -name "*.py" | \
                xargs grep -l "from.*repositories" 2>/dev/null | wc -l)
            if [[ $router_issues -gt 0 ]]; then
                echo "  • Remove direct repository imports from routers"
                echo "    Routers should only import and use services"
                echo "    Example: from app.services import UserService"
            fi
        fi

        echo "  • Ensure proper layering: Router → Service → Repository → Model"
        echo "  • Use dependency injection for service dependencies"
        echo "  • Implement proper error handling with ErrorResponse"
    fi

    # Frontend suggestions
    if [[ $frontend_violations -gt 0 ]]; then
        echo "🔧 Frontend Architecture Fixes:"

        if [[ ! -d "apps/web/src/app" ]]; then
            echo "  • Migrate to Next.js App Router structure"
            echo "    Create apps/web/src/app directory for new routing"
        fi

        if [[ ! -d "apps/web/src/components" ]]; then
            echo "  • Create proper component organization:"
            echo "    mkdir -p apps/web/src/components/{ui,forms,layout,marketing}"
        fi

        direct_radix=$(find apps/web/src -name "*.tsx" -o -name "*.ts" | \
            xargs grep -l "@radix-ui" 2>/dev/null | wc -l || echo "0")
        if [[ $direct_radix -gt 0 ]]; then
            echo "  • Replace direct Radix UI imports with @miethe/ui components"
            echo "    Instead of: import { Button } from '@radix-ui/react-button'"
            echo "    Use: import { Button } from '@miethe/ui'"
        fi

        echo "  • Follow atomic design principles for component organization"
        echo "  • Use proper TypeScript patterns and prop interfaces"
        echo "  • Implement proper error boundaries"
    fi

    # UI package suggestions
    if [[ $ui_violations -gt 0 ]]; then
        echo "🔧 UI Package Fixes:"
        echo "  • Add missing Storybook stories for all components"
        echo "  • Ensure proper TypeScript definitions are exported"
        echo "  • Add accessibility testing to component stories"
        echo "  • Follow design system token patterns"
    fi
fi
```

## Final Report

Generate comprehensive architecture compliance report:

```bash
echo -e "\n=== Architecture Compliance Summary ==="

# Calculate total violations
total_violations=$((backend_violations + frontend_violations + ui_violations))

# Generate structured report
if type generate_report >/dev/null 2>&1; then
    # Add summary sections
    if [[ "$component" == "backend" || "$component" == "all" ]]; then
        if [[ $backend_violations -eq 0 ]]; then
            add_success "Backend architecture compliance verified"
        else
            add_error "Backend architecture violations detected"
        fi
    fi

    if [[ "$component" == "frontend" || "$component" == "all" ]]; then
        if [[ $frontend_violations -eq 0 ]]; then
            add_success "Frontend architecture compliance verified"
        else
            add_error "Frontend architecture violations detected"
        fi
    fi

    # Generate final report in requested format
    generate_report "$report_format"
else
    # Fallback summary
    echo "Architecture Compliance Results:"
    echo "  Backend violations: $backend_violations"
    echo "  Frontend violations: $frontend_violations"
    echo "  UI package violations: $ui_violations"
    echo "  Total violations: $total_violations"
    echo ""
    echo "Component validated: $component"
    echo "Strict mode: $strict_mode"
    echo "Timestamp: $(date)"
fi

# Exit with appropriate status
if [[ $total_violations -eq 0 ]]; then
    echo -e "\n🎉 Architecture Compliance Verified!"
    echo "✅ All layers follow MeatyPrompts patterns"
    echo "✅ No architecture violations detected"
    echo "✅ Project structure is compliant"

    if [[ "$fix_suggestions" == "true" ]]; then
        echo -e "\n💡 Architecture Best Practices:"
        echo "  • Continue following the layered architecture pattern"
        echo "  • Use dependency injection for service dependencies"
        echo "  • Keep components atomic and reusable"
        echo "  • Maintain separation of concerns across layers"
        echo "  • Regular architecture reviews as project grows"
    fi

    exit 0
else
    echo -e "\n🚨 Architecture Violations Detected!"
    echo "❌ Found $total_violations violations that should be addressed"

    if [[ $backend_violations -gt 0 ]]; then
        echo "❌ Backend violations: $backend_violations"
    fi

    if [[ $frontend_violations -gt 0 ]]; then
        echo "❌ Frontend violations: $frontend_violations"
    fi

    if [[ $ui_violations -gt 0 ]]; then
        echo "❌ UI package violations: $ui_violations"
    fi

    echo -e "\n🔧 Next Steps:"
    echo "  • Review the violations above"
    echo "  • Use --fix-suggestions for detailed remediation steps"
    echo "  • Run /post-implementation-updates after fixes"
    echo "  • Consider architectural refactoring for major violations"

    echo -e "\n📚 Resources:"
    echo "  • MeatyPrompts Architecture Guide: CLAUDE.md"
    echo "  • Layer documentation: docs/architecture/"
    echo "  • Component patterns: packages/ui/README.md"

    exit 1
fi
```

This command validates MeatyPrompts architecture compliance using shared utilities while providing comprehensive feedback and actionable suggestions for maintaining clean, layered architecture patterns.
