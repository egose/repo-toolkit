"use strict";
(globalThis["webpackChunkwebsite"] = globalThis["webpackChunkwebsite"] || []).push([[78],{

/***/ 4369
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  assets: () => (/* binding */ assets),
  contentTitle: () => (/* binding */ contentTitle),
  "default": () => (/* binding */ MDXContent),
  frontMatter: () => (/* binding */ frontMatter),
  metadata: () => (/* reexport */ site_docs_packages_compose_sandbox_md_4a9_namespaceObject),
  toc: () => (/* binding */ toc)
});

;// ./.docusaurus/docusaurus-plugin-content-docs/default/site-docs-packages-compose-sandbox-md-4a9.json
const site_docs_packages_compose_sandbox_md_4a9_namespaceObject = /*#__PURE__*/JSON.parse('{"id":"packages/compose-sandbox","title":"@repo-toolkit/compose-sandbox","description":"@repo-toolkit/compose-sandbox runs a repository-defined Docker Compose test sandbox through a deterministic lifecycle:","source":"@site/docs/packages/compose-sandbox.md","sourceDirName":"packages","slug":"/packages/compose-sandbox","permalink":"/docs/packages/compose-sandbox","draft":false,"unlisted":false,"tags":[],"version":"current","sidebarPosition":7,"frontMatter":{"sidebar_label":"Compose Sandbox","sidebar_position":7},"sidebar":"packagesSidebar","previous":{"title":"Go Release","permalink":"/docs/packages/go-release"}}');
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(1325);
// EXTERNAL MODULE: ./node_modules/.pnpm/@mdx-js+react@3.1.1_@types+react@19.2.14_react@19.2.6/node_modules/@mdx-js/react/lib/index.js
var lib = __webpack_require__(1982);
;// ./docs/packages/compose-sandbox.md


const frontMatter = {
	sidebar_label: 'Compose Sandbox',
	sidebar_position: 7
};
const contentTitle = '@repo-toolkit/compose-sandbox';

const assets = {

};



const toc = [{
  "value": "Requirements",
  "id": "requirements",
  "level": 2
}, {
  "value": "Install",
  "id": "install",
  "level": 2
}, {
  "value": "CLI",
  "id": "cli",
  "level": 2
}, {
  "value": "Lifecycle",
  "id": "lifecycle",
  "level": 2
}, {
  "value": "Configuration reference",
  "id": "configuration-reference",
  "level": 2
}, {
  "value": "Working configurations (reference repositories)",
  "id": "working-configurations-reference-repositories",
  "level": 2
}, {
  "value": "<code>_database-tools</code> shape — mixed TCP/HTTP/one-shot + Bats",
  "id": "_database-tools-shape--mixed-tcphttpone-shot--bats",
  "level": 3
}, {
  "value": "<code>_vite-fastapi-postgres-template</code> shape — multiple HTTP endpoints + Playwright",
  "id": "_vite-fastapi-postgres-template-shape--multiple-http-endpoints--playwright",
  "level": 3
}, {
  "value": "Library",
  "id": "library",
  "level": 2
}, {
  "value": "Local / CI examples",
  "id": "local--ci-examples",
  "level": 2
}, {
  "value": "Deferred",
  "id": "deferred",
  "level": 2
}];
function _createMdxContent(props) {
  const _components = {
    code: "code",
    h1: "h1",
    h2: "h2",
    h3: "h3",
    header: "header",
    li: "li",
    p: "p",
    pre: "pre",
    strong: "strong",
    table: "table",
    tbody: "tbody",
    td: "td",
    th: "th",
    thead: "thead",
    tr: "tr",
    ul: "ul",
    ...(0,lib/* useMDXComponents */.R)(),
    ...props.components
  };
  return (0,jsx_runtime.jsxs)(jsx_runtime.Fragment, {
    children: [(0,jsx_runtime.jsx)(_components.header, {
      children: (0,jsx_runtime.jsx)(_components.h1, {
        id: "repo-toolkitcompose-sandbox",
        children: (0,jsx_runtime.jsx)(_components.code, {
          children: "@repo-toolkit/compose-sandbox"
        })
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "@repo-toolkit/compose-sandbox"
      }), " runs a repository-defined Docker Compose test sandbox through a deterministic lifecycle:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-text",
        children: "validate -> prepare -> start -> wait -> test -> collect evidence -> clean up\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The runner uses structured ", (0,jsx_runtime.jsx)(_components.code, {
        children: "docker compose"
      }), " commands (executable + argument arrays, no shell), bounded probes, and deterministic cleanup. It is usable from a developer shell and from a thin wrapper in ", (0,jsx_runtime.jsx)(_components.code, {
        children: "_egose-actions"
      }), " without knowing about PostgreSQL, MongoDB, MinIO, Keycloak, Playwright, Bats, or GitHub Actions."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "requirements",
      children: "Requirements"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "Node.js 20 or newer."
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Docker with Compose v2 (", (0,jsx_runtime.jsx)(_components.code, {
          children: "docker compose"
        }), ") for any non-", (0,jsx_runtime.jsx)(_components.code, {
          children: "--dry-run"
        }), " execution."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "--dry-run"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--help"
      }), " require neither Docker nor network access. No YAML runtime dependency in the first release; JSON and JavaScript config only."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "install",
      children: "Install"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "pnpm add -D @repo-toolkit/compose-sandbox\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Root script:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "pnpm compose-sandbox -- --help\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "cli",
      children: "CLI"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-compose-sandbox --help\nrepo-toolkit-compose-sandbox --config compose-sandbox.json --dry-run\nrepo-toolkit-compose-sandbox --config compose-sandbox.mjs --project-name ci-$GITHUB_RUN_ID --evidence-dir .ci-logs\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "Flag"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Purpose"
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--config <path>"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Config file (JSON, ", (0,jsx_runtime.jsx)(_components.code, {
              children: ".mjs"
            }), ", or ", (0,jsx_runtime.jsx)(_components.code, {
              children: ".cjs"
            }), " default export). Resolved via ", (0,jsx_runtime.jsx)(_components.code, {
              children: "@repo-toolkit/publish-package"
            }), " ", (0,jsx_runtime.jsx)(_components.code, {
              children: "loadConfigFile"
            }), "."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--cwd <path>"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Project root; overrides config ", (0,jsx_runtime.jsx)(_components.code, {
              children: "cwd"
            }), "."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--compose-file <path>"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Repeatable. Overrides ", (0,jsx_runtime.jsx)(_components.code, {
              children: "compose.files"
            }), "."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--project-name <name>"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Overrides ", (0,jsx_runtime.jsx)(_components.code, {
              children: "compose.projectName"
            }), " (", (0,jsx_runtime.jsx)(_components.code, {
              children: "^[a-z0-9][a-z0-9_-]*$"
            }), ", ≤64 chars)."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--evidence-dir <path>"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Overrides ", (0,jsx_runtime.jsx)(_components.code, {
              children: "evidence.directory"
            }), " (contained under ", (0,jsx_runtime.jsx)(_components.code, {
              children: "cwd"
            }), ")."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--dry-run"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Resolve, validate, and print the redacted plan (JSON) without running Docker."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "-h, --help"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Show help and exit 0."
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "--dry-run"
      }), " prints a redacted plan (", (0,jsx_runtime.jsx)(_components.code, {
        children: "test.env"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "readiness[].env"
      }), " values -> ", (0,jsx_runtime.jsx)(_components.code, {
        children: "[REDACTED]"
      }), ", HTTP auth/token headers -> ", (0,jsx_runtime.jsx)(_components.code, {
        children: "[REDACTED]"
      }), ") to stdout and exits 0 without spawning Docker. Invalid config exits nonzero with a concise message, no stack trace, and no secrets. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--config"
      }), " JS execution trusts the config as repository code; ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--config"
      }), " JSON is parsed via ", (0,jsx_runtime.jsx)(_components.code, {
        children: "JSON.parse"
      }), "."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Overrides are intentionally narrow: only ", (0,jsx_runtime.jsx)(_components.code, {
        children: "cwd"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "compose.files"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "compose.projectName"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "evidence.directory"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "dryRun"
      }), " are CLI-overridable; all other behavior belongs in the config file."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "lifecycle",
      children: "Lifecycle"
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "Phase"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Description"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Failure handling"
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.strong, {
              children: "validate"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Strict runtime type checks, unknown-key rejection, duplicate-probe rejection, project/service/URL/port/timeout/env validation, relative-path + ", (0,jsx_runtime.jsx)(_components.code, {
              children: ".."
            }), " + NUL + containment checks. No I/O."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Returns primary immediately; no side effects."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.strong, {
              children: "prepare"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Create ", (0,jsx_runtime.jsx)(_components.code, {
              children: "prepare.directories"
            }), " and copy ", (0,jsx_runtime.jsx)(_components.code, {
              children: "prepare.copies"
            }), " (", (0,jsx_runtime.jsx)(_components.code, {
              children: "from"
            }), " -> ", (0,jsx_runtime.jsx)(_components.code, {
              children: "to"
            }), ") under ", (0,jsx_runtime.jsx)(_components.code, {
              children: "cwd"
            }), " after validating sources."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Primary preserved; evidence + cleanup still run."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.strong, {
              children: "preflight"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "docker compose version"
            }), " check using ", (0,jsx_runtime.jsx)(_components.code, {
              children: "compose.executable"
            }), " (", (0,jsx_runtime.jsx)(_components.code, {
              children: "docker"
            }), " by default)."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Primary preserved."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.strong, {
              children: "start"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "docker compose up -d"
            }), " with ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--build"
            }), "/", (0,jsx_runtime.jsx)(_components.code, {
              children: "--pull"
            }), "/", (0,jsx_runtime.jsx)(_components.code, {
              children: "--profile"
            }), "/", (0,jsx_runtime.jsx)(_components.code, {
              children: "--env-file"
            }), "/", (0,jsx_runtime.jsx)(_components.code, {
              children: "--project-name"
            }), " per plan."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Primary preserved."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.strong, {
              children: "wait"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Poll probes until ", (0,jsx_runtime.jsx)(_components.code, {
              children: "timeouts.readinessMs"
            }), " (default 120s): ", (0,jsx_runtime.jsx)(_components.code, {
              children: "tcp"
            }), " (connect), ", (0,jsx_runtime.jsx)(_components.code, {
              children: "http"
            }), " (status range ", (0,jsx_runtime.jsx)(_components.code, {
              children: "expectedStatus"
            }), ", default ", (0,jsx_runtime.jsx)(_components.code, {
              children: "200-299"
            }), "), ", (0,jsx_runtime.jsx)(_components.code, {
              children: "service-running"
            }), ", ", (0,jsx_runtime.jsx)(_components.code, {
              children: "service-completed"
            }), " (exit code 0 with actionable state/exit-code diagnostics), ", (0,jsx_runtime.jsx)(_components.code, {
              children: "command"
            }), " (structured probe, ", (0,jsx_runtime.jsx)(_components.code, {
              children: "timeoutMs"
            }), " 30s default). Independent probes run concurrently with cancellation-safe diagnostics."]
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Timeout lists every unsatisfied probe; failed one-shot fails immediately with ", (0,jsx_runtime.jsx)(_components.code, {
              children: "ServiceProbeError"
            }), " including service/state/exitCode."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.strong, {
              children: "test"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "spawn(test.executable, test.args, { cwd: test.resolvedCwd ?? cwd, env: { ...process.env, ...test.env } })"
            }), ", ", (0,jsx_runtime.jsx)(_components.code, {
              children: "inheritStdio: true"
            }), ", ", (0,jsx_runtime.jsx)(_components.code, {
              children: "timeoutMs: timeouts.testMs"
            }), " (default 300s). Runs only after all readiness passes."]
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Nonzero exit code -> primary ", (0,jsx_runtime.jsx)(_components.code, {
              children: "exitCode"
            }), "; timeout -> primary timedOut."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.strong, {
              children: "collect evidence"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["If ", (0,jsx_runtime.jsx)(_components.code, {
              children: "evidence.capture === 'always'"
            }), " or outcome is failure, ", (0,jsx_runtime.jsx)(_components.code, {
              children: "docker compose ps -a --format json"
            }), " -> ", (0,jsx_runtime.jsx)(_components.code, {
              children: "ps.json"
            }), " and ", (0,jsx_runtime.jsx)(_components.code, {
              children: "docker compose logs --no-color"
            }), " -> ", (0,jsx_runtime.jsx)(_components.code, {
              children: "logs.txt"
            }), " (bounded by ", (0,jsx_runtime.jsx)(_components.code, {
              children: "evidence.maxLogBytes"
            }), ", default 1 MiB, max 10 MiB, ANSI stripped if ", (0,jsx_runtime.jsx)(_components.code, {
              children: "stripAnsi"
            }), "). Writes ", (0,jsx_runtime.jsx)(_components.code, {
              children: "result.json"
            }), " manifest ", (0,jsx_runtime.jsx)(_components.code, {
              children: "{ phase, outcome, timings, evidenceFiles, errors: { primary, secondary } }"
            }), " with sanitized (ANSI-stripped, truncated, redacted) messages, no env secrets. Evidence is written before teardown."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Evidence failure becomes primary if no earlier failure, otherwise secondary."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.strong, {
              children: "clean up"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "docker compose down"
            }), " (", (0,jsx_runtime.jsx)(_components.code, {
              children: "--volumes"
            }), "/", (0,jsx_runtime.jsx)(_components.code, {
              children: "--remove-orphans"
            }), " per ", (0,jsx_runtime.jsx)(_components.code, {
              children: "cleanup"
            }), ") then ", (0,jsx_runtime.jsx)(_components.code, {
              children: "rm -rf"
            }), " each ", (0,jsx_runtime.jsx)(_components.code, {
              children: "cleanup.paths"
            }), " (contained, non-root, symlink-target-inside-project-checked, idempotent). Runs on success, failure, timeout, and ", (0,jsx_runtime.jsx)(_components.code, {
              children: "SIGINT"
            }), "/", (0,jsx_runtime.jsx)(_components.code, {
              children: "SIGTERM"
            }), "; at most once and only after ", (0,jsx_runtime.jsx)(_components.code, {
              children: "start"
            }), " began. ", (0,jsx_runtime.jsx)(_components.code, {
              children: "cleanupMs"
            }), " default 30s."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Cleanup failure never replaces primary; reported as secondary."
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "timeouts.totalMs"
      }), " (optional) aborts the whole lifecycle via a single ", (0,jsx_runtime.jsx)(_components.code, {
        children: "AbortController"
      }), "; ", (0,jsx_runtime.jsx)(_components.code, {
        children: "startupMs"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "readinessMs"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "testMs"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "cleanupMs"
      }), " bound individual phases. Signal handlers for ", (0,jsx_runtime.jsx)(_components.code, {
        children: "SIGINT"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "SIGTERM"
      }), " are registered per ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runLifecycle"
      }), " invocation and removed afterwards (no cross-call leaks). Child processes are terminated via process-group where supported."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "configuration-reference",
      children: "Configuration reference"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Configuration is a plain object (JSON or JS default export). Unknown keys are rejected at any level."
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "type ComposeSandboxOptions = {\n  cwd?: string; // default '.'\n  compose: {\n    executable?: string; // default 'docker'\n    files: string[]; // required, >=1, relative, contained\n    envFile?: string; // relative, contained\n    projectName?: string; // ^[a-z0-9][a-z0-9_-]*$\n    profiles?: string[]; // service-name shaped\n    build?: boolean;\n    pull?: boolean;\n  };\n  prepare?: {\n    directories?: string[]; // relative, contained, not '.'\n    copies?: Array<{ from: string; to: string }>; // both relative, contained, not '.'\n  };\n  readiness?: Array<\n    | { type: 'tcp'; host: string; port: number; timeoutMs?: number; intervalMs?: number }\n    | {\n        type: 'http';\n        url: string;\n        method?: string;\n        expectedStatus?: number | number[] | [number, number];\n        headers?: Record<string, string>;\n        timeoutMs?: number;\n        intervalMs?: number;\n      }\n    | { type: 'service-running'; service: string; timeoutMs?: number; intervalMs?: number }\n    | { type: 'service-completed'; service: string; timeoutMs?: number; intervalMs?: number }\n    | { type: 'command'; executable: string; args?: string[]; env?: Record<string, string>; timeoutMs?: number }\n  >;\n  test: { executable: string; args?: string[]; env?: Record<string, string>; cwd?: string };\n  evidence?: { directory?: string; capture?: 'always' | 'onFailure'; maxLogBytes?: number; stripAnsi?: boolean };\n  cleanup?: { volumes?: boolean; removeOrphans?: boolean; paths?: string[] };\n  timeouts?: { startupMs?: number; readinessMs?: number; testMs?: number; cleanupMs?: number; totalMs?: number };\n  dryRun?: boolean;\n  config?: string; // CLI only: path to config file\n};\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Defaults: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "evidence.directory='.compose-sandbox-logs'"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "capture='onFailure'"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "maxLogBytes=1_048_576"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "stripAnsi=true"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "cleanup.removeOrphans=true"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "timeouts={ startupMs: 120000, readinessMs: 120000, testMs: 300000, cleanupMs: 30000 }"
      }), ", probe ", (0,jsx_runtime.jsx)(_components.code, {
        children: "timeoutMs=5000"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "intervalMs=1000"
      }), " (command 30000), ", (0,jsx_runtime.jsx)(_components.code, {
        children: "compose.executable='docker'"
      }), "."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Path rules: every configurable path is normalized (backslash->slash, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "."
      }), " segments removed), must be relative, must not contain ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".."
      }), " or NUL, must resolve inside ", (0,jsx_runtime.jsx)(_components.code, {
        children: "cwd"
      }), ". ", (0,jsx_runtime.jsx)(_components.code, {
        children: "cleanup.paths"
      }), " duplicates and project-root targets rejected. Symmetric validation ensures plan resolution is side-effect free and supports ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--dry-run"
      }), " without requiring files to exist."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Security boundaries: structured commands never evaluated as shell source; config is trusted repository code but still validated; environment secrets are redacted from dry-run output, logs, and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "result.json"
      }), " errors; HTTP ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Authorization"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "token"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "secret"
      }), " headers are redacted; cleanup cannot escape the project (including via symlink targets)."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "working-configurations-reference-repositories",
      children: "Working configurations (reference repositories)"
    }), "\n", (0,jsx_runtime.jsxs)(_components.h3, {
      id: "_database-tools-shape--mixed-tcphttpone-shot--bats",
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "_database-tools"
      }), " shape — mixed TCP/HTTP/one-shot + Bats"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Original sandbox: two Compose files (", (0,jsx_runtime.jsx)(_components.code, {
        children: "sandbox/docker-compose.yml"
      }), " + ", (0,jsx_runtime.jsx)(_components.code, {
        children: "sandbox/docker-compose-ci.yml"
      }), "), env file, TCP checks for Postgres/Mongo, HTTP for MinIO, one-shot ", (0,jsx_runtime.jsx)(_components.code, {
        children: "minio-init"
      }), " completion, Bats test command. Isolated fixture: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "test/fixtures/database-tools-shaped/"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-js",
        children: "// compose-sandbox.database-tools.config.mjs\nexport default {\n  cwd: '.',\n  compose: {\n    files: ['sandbox/docker-compose.yml', 'sandbox/docker-compose-ci.yml'],\n    envFile: 'sandbox/.env.dev',\n    projectName: 'database-tools',\n  },\n  prepare: {\n    directories: ['sandbox/data/pg', 'sandbox/data/mongo', 'sandbox/data/minio'],\n  },\n  readiness: [\n    { type: 'tcp', host: '127.0.0.1', port: 5432 },\n    { type: 'tcp', host: '127.0.0.1', port: 27017 },\n    { type: 'http', url: 'http://127.0.0.1:9000/minio/health/live' },\n    { type: 'service-completed', service: 'minio-init' },\n  ],\n  test: { executable: 'pnpm', args: ['exec', 'bats', 'tests/integration'] },\n  evidence: { directory: '.compose-logs', capture: 'onFailure' },\n  cleanup: { volumes: true, removeOrphans: true, paths: ['sandbox/data/pg', 'sandbox/data/mongo'] },\n};\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Equivalent JSON is valid. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--dry-run"
      }), " validates without Docker; CI uses ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--project-name database-tools-${{ github.run_id }}"
      }), " for isolation."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.h3, {
      id: "_vite-fastapi-postgres-template-shape--multiple-http-endpoints--playwright",
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "_vite-fastapi-postgres-template"
      }), " shape — multiple HTTP endpoints + Playwright"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Original sandbox: Compose files (", (0,jsx_runtime.jsx)(_components.code, {
        children: "sandbox/docker-compose.yml"
      }), " + ", (0,jsx_runtime.jsx)(_components.code, {
        children: "sandbox/docker-compose-apps.yml"
      }), "), HTTP for Keycloak (", (0,jsx_runtime.jsx)(_components.code, {
        children: "/realms/master"
      }), "), API (", (0,jsx_runtime.jsx)(_components.code, {
        children: "/api/v1/info"
      }), "), frontend, Playwright test command. Isolated fixture: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "test/fixtures/vite-fastapi-shaped/"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-js",
        children: "// compose-sandbox.vite-fastapi.config.mjs\nexport default {\n  cwd: '.',\n  compose: {\n    files: ['sandbox/docker-compose.yml', 'sandbox/docker-compose-apps.yml'],\n    projectName: 'vfpt',\n  },\n  readiness: [\n    { type: 'http', url: 'http://127.0.0.1:8080/realms/master', expectedStatus: 200 },\n    { type: 'http', url: 'http://127.0.0.1:8000/api/v1/info' },\n    { type: 'http', url: 'http://127.0.0.1:3000', expectedStatus: [200, 299] },\n  ],\n  test: { executable: 'pnpm', args: ['playwright:test'] },\n  evidence: { directory: '.ci-logs', capture: 'always' },\n  cleanup: { volumes: true, removeOrphans: true },\n};\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Both fixtures are validated by ", (0,jsx_runtime.jsx)(_components.code, {
        children: "test/fixtures.test.ts"
      }), " and exercised by the real-Compose integration test without requiring the full source trees."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "library",
      children: "Library"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import { resolveComposeSandboxPlan, runComposeSandbox } from '@repo-toolkit/compose-sandbox';\n\nconst plan = resolveComposeSandboxPlan({\n  cwd: '.',\n  compose: { files: ['docker-compose.yml'] },\n  test: { executable: 'pnpm', args: ['test'] },\n});\n\nawait runComposeSandbox({ config: './compose-sandbox.json', cwd: '.' });\nawait runComposeSandbox({\n  cwd: '.',\n  compose: { files: ['a.yml'] },\n  test: { executable: 'echo', args: ['hi'] },\n  dryRun: true,\n});\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "resolveComposeSandboxPlan(options?)"
        }), " is side-effect free, deep-freezes the plan, never touches the filesystem or network."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "runComposeSandbox(options?, deps?)"
        }), " injects ", (0,jsx_runtime.jsx)(_components.code, {
          children: "clock"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "signalTarget"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "createAbortController"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "runProcess"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "tcpConnect"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "httpFetch"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "getServiceState"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "runCommandProbe"
        }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "fs"
        }), " for isolated unit/integration testing."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "local--ci-examples",
      children: "Local / CI examples"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Local dry-run (no Docker):"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-compose-sandbox --config compose-sandbox.json --dry-run | jq .\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Local with evidence always captured:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-compose-sandbox --config compose-sandbox.json --evidence-dir .compose-logs\ncat .compose-logs/result.json | jq .\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["GitHub Actions (GitHub-hosted Linux, Docker available), forced failure + leak check verified by ", (0,jsx_runtime.jsx)(_components.code, {
        children: "test/real-compose.test.ts"
      }), ":"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-yaml",
        children: "jobs:\n  integration:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: pnpm/action-setup@v4\n      - run: pnpm install\n      - run: pnpm compose-sandbox -- --config compose-sandbox.json --project-name ci-${{ github.run_id }} --evidence-dir .ci-logs\n      - uses: actions/upload-artifact@v4\n        if: always()\n        with: { name: compose-logs, path: .ci-logs }\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "deferred",
      children: "Deferred"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "YAML configuration (deferred; add only after demonstrated demand and an explicit runtime-dependency decision)."
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Legacy ", (0,jsx_runtime.jsx)(_components.code, {
          children: "docker-compose"
        }), " (Python) executable — use ", (0,jsx_runtime.jsx)(_components.code, {
          children: "docker compose"
        }), " only."]
      }), "\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "Shared/published Compose service definitions."
      }), "\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "GitHub artifact upload, summary, or environment-variable dependency."
      }), "\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "Automatic Make/shell-snippet translation or consumer repository migrations."
      }), "\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "Swarm/Kubernetes/Podman Compose."
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The runner is GitHub-independent and never installs service-specific clients, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "mongosh"
      }), ", Bats, Playwright, or package managers."]
    })]
  });
}
function MDXContent(props = {}) {
  const {wrapper: MDXLayout} = {
    ...(0,lib/* useMDXComponents */.R)(),
    ...props.components
  };
  return MDXLayout ? (0,jsx_runtime.jsx)(MDXLayout, {
    ...props,
    children: (0,jsx_runtime.jsx)(_createMdxContent, {
      ...props
    })
  }) : _createMdxContent(props);
}



/***/ },

/***/ 1982
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   R: () => (/* binding */ useMDXComponents),
/* harmony export */   x: () => (/* binding */ MDXProvider)
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(489);
/**
 * @import {MDXComponents} from 'mdx/types.js'
 * @import {Component, ReactElement, ReactNode} from 'react'
 */

/**
 * @callback MergeComponents
 *   Custom merge function.
 * @param {Readonly<MDXComponents>} currentComponents
 *   Current components from the context.
 * @returns {MDXComponents}
 *   Additional components.
 *
 * @typedef Props
 *   Configuration for `MDXProvider`.
 * @property {ReactNode | null | undefined} [children]
 *   Children (optional).
 * @property {Readonly<MDXComponents> | MergeComponents | null | undefined} [components]
 *   Additional components to use or a function that creates them (optional).
 * @property {boolean | null | undefined} [disableParentContext=false]
 *   Turn off outer component context (default: `false`).
 */



/** @type {Readonly<MDXComponents>} */
const emptyComponents = {}

const MDXContext = react__WEBPACK_IMPORTED_MODULE_0__.createContext(emptyComponents)

/**
 * Get current components from the MDX Context.
 *
 * @param {Readonly<MDXComponents> | MergeComponents | null | undefined} [components]
 *   Additional components to use or a function that creates them (optional).
 * @returns {MDXComponents}
 *   Current components.
 */
function useMDXComponents(components) {
  const contextComponents = react__WEBPACK_IMPORTED_MODULE_0__.useContext(MDXContext)

  // Memoize to avoid unnecessary top-level context changes
  return react__WEBPACK_IMPORTED_MODULE_0__.useMemo(
    function () {
      // Custom merge via a function prop
      if (typeof components === 'function') {
        return components(contextComponents)
      }

      return {...contextComponents, ...components}
    },
    [contextComponents, components]
  )
}

/**
 * Provider for MDX context.
 *
 * @param {Readonly<Props>} properties
 *   Properties.
 * @returns {ReactElement}
 *   Element.
 * @satisfies {Component}
 */
function MDXProvider(properties) {
  /** @type {Readonly<MDXComponents>} */
  let allComponents

  if (properties.disableParentContext) {
    allComponents =
      typeof properties.components === 'function'
        ? properties.components(emptyComponents)
        : properties.components || emptyComponents
  } else {
    allComponents = useMDXComponents(properties.components)
  }

  return react__WEBPACK_IMPORTED_MODULE_0__.createElement(
    MDXContext.Provider,
    {value: allComponents},
    properties.children
  )
}


/***/ }

}]);