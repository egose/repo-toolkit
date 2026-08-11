"use strict";
(globalThis["webpackChunkwebsite"] = globalThis["webpackChunkwebsite"] || []).push([[195],{

/***/ 2812
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  assets: () => (/* binding */ assets),
  contentTitle: () => (/* binding */ contentTitle),
  "default": () => (/* binding */ MDXContent),
  frontMatter: () => (/* binding */ frontMatter),
  metadata: () => (/* reexport */ site_docs_packages_confluence_md_973_namespaceObject),
  toc: () => (/* binding */ toc)
});

;// ./.docusaurus/docusaurus-plugin-content-docs/default/site-docs-packages-confluence-md-973.json
const site_docs_packages_confluence_md_973_namespaceObject = /*#__PURE__*/JSON.parse('{"id":"packages/confluence","title":"@repo-toolkit/confluence","description":"Sync a folder of Markdown documentation to Confluence, mirroring the directory","source":"@site/docs/packages/confluence.md","sourceDirName":"packages","slug":"/packages/confluence","permalink":"/docs/packages/confluence","draft":false,"unlisted":false,"tags":[],"version":"current","sidebarPosition":5,"frontMatter":{"sidebar_label":"Confluence","sidebar_position":5},"sidebar":"packagesSidebar","previous":{"title":"Release Artifact","permalink":"/docs/packages/release-artifact"}}');
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(1325);
// EXTERNAL MODULE: ./node_modules/.pnpm/@mdx-js+react@3.1.1_@types+react@19.2.14_react@19.2.6/node_modules/@mdx-js/react/lib/index.js
var lib = __webpack_require__(1982);
// EXTERNAL MODULE: ./node_modules/.pnpm/@docusaurus+theme-classic@3.10.1_@types+react@19.2.14_react-dom@19.2.6_react@19.2.6__react@19.2.6_typescript@6.0.3/node_modules/@docusaurus/theme-classic/lib/theme/Tabs/index.js + 1 modules
var Tabs = __webpack_require__(5250);
// EXTERNAL MODULE: ./node_modules/.pnpm/@docusaurus+theme-classic@3.10.1_@types+react@19.2.14_react-dom@19.2.6_react@19.2.6__react@19.2.6_typescript@6.0.3/node_modules/@docusaurus/theme-classic/lib/theme/TabItem/index.js + 1 modules
var TabItem = __webpack_require__(6574);
;// ./docs/packages/confluence.md


const frontMatter = {
	sidebar_label: 'Confluence',
	sidebar_position: 5
};
const contentTitle = '@repo-toolkit/confluence';

const assets = {

};





const toc = [{
  "value": "Install",
  "id": "install",
  "level": 2
}, {
  "value": "CLI",
  "id": "cli",
  "level": 2
}, {
  "value": "Flags",
  "id": "flags",
  "level": 3
}, {
  "value": "Configuration precedence",
  "id": "configuration-precedence",
  "level": 2
}, {
  "value": "Environment variables",
  "id": "environment-variables",
  "level": 3
}, {
  "value": "Credentials",
  "id": "credentials",
  "level": 2
}, {
  "value": "<code>--interactive</code>",
  "id": "--interactive",
  "level": 2
}, {
  "value": "Raw HTML and security",
  "id": "raw-html-and-security",
  "level": 2
}, {
  "value": "Supported Markdown",
  "id": "supported-markdown",
  "level": 2
}, {
  "value": "Mermaid",
  "id": "mermaid",
  "level": 2
}, {
  "value": "Optimistic concurrency",
  "id": "optimistic-concurrency",
  "level": 2
}, {
  "value": "Additive (non-pruning) sync",
  "id": "additive-non-pruning-sync",
  "level": 2
}, {
  "value": "JavaScript API",
  "id": "javascript-api",
  "level": 2
}, {
  "value": "Custom gateway (typed testing / non-Confluence backends)",
  "id": "custom-gateway-typed-testing--non-confluence-backends",
  "level": 3
}, {
  "value": "Exports",
  "id": "exports",
  "level": 3
}, {
  "value": "GitHub Action usage",
  "id": "github-action-usage",
  "level": 2
}];
function _createMdxContent(props) {
  const _components = {
    a: "a",
    code: "code",
    h1: "h1",
    h2: "h2",
    h3: "h3",
    header: "header",
    li: "li",
    ol: "ol",
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
        id: "repo-toolkitconfluence",
        children: (0,jsx_runtime.jsx)(_components.code, {
          children: "@repo-toolkit/confluence"
        })
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Sync a folder of Markdown documentation to Confluence, mirroring the directory\nstructure as a page hierarchy. Each Markdown file becomes one Confluence page\nunder the configured parent; each sub-folder becomes a parent page. Local\nimages referenced from the markdown are uploaded as Confluence attachments and\ninline-rendered as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "<ac:image><ri:attachment />"
      }), " macros; remote images stay as\n", (0,jsx_runtime.jsx)(_components.code, {
        children: "<ac:image><ri:url />"
      }), "."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The package is GitHub-Action compatible: with no CLI flags it reads ", (0,jsx_runtime.jsx)(_components.code, {
        children: "INPUT_*"
      }), "\nenvironment variables (the same shape as the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Bhacaz/docs-as-code-confluence"
      }), "\naction's ", (0,jsx_runtime.jsx)(_components.code, {
        children: "action.yml"
      }), "), so you can drop it into a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "node20"
      }), " action or run it as\na standalone CLI."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The package-local ", (0,jsx_runtime.jsx)(_components.a, {
        href: "https://github.com/egose/repo-toolkit/blob/main/packages/confluence/README.md",
        children: (0,jsx_runtime.jsx)(_components.code, {
          children: "README.md"
        })
      }), "\nstays concise; this guide is the canonical, behavior-exact reference. CLI help\n(", (0,jsx_runtime.jsx)(_components.code, {
        children: "repo-toolkit-confluence --help"
      }), ") and the API defaults in\n", (0,jsx_runtime.jsx)(_components.code, {
        children: "resolveConfluenceSyncPlan"
      }), " agree with everything documented here."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "install",
      children: "Install"
    }), "\n", (0,jsx_runtime.jsxs)(Tabs/* default */.A, {
      groupId: "npm2yarn",
      children: [(0,jsx_runtime.jsx)(TabItem/* default */.A, {
        value: "npm",
        children: (0,jsx_runtime.jsx)(_components.pre, {
          children: (0,jsx_runtime.jsx)(_components.code, {
            className: "language-bash",
            children: "npm install --save-dev @repo-toolkit/confluence\n"
          })
        })
      }), (0,jsx_runtime.jsx)(TabItem/* default */.A, {
        value: "yarn",
        label: "Yarn",
        children: (0,jsx_runtime.jsx)(_components.pre, {
          children: (0,jsx_runtime.jsx)(_components.code, {
            className: "language-bash",
            children: "yarn add --dev @repo-toolkit/confluence\n"
          })
        })
      }), (0,jsx_runtime.jsx)(TabItem/* default */.A, {
        value: "pnpm",
        label: "pnpm",
        children: (0,jsx_runtime.jsx)(_components.pre, {
          children: (0,jsx_runtime.jsx)(_components.code, {
            className: "language-bash",
            children: "pnpm add --save-dev @repo-toolkit/confluence\n"
          })
        })
      }), (0,jsx_runtime.jsx)(TabItem/* default */.A, {
        value: "bun",
        label: "Bun",
        children: (0,jsx_runtime.jsx)(_components.pre, {
          children: (0,jsx_runtime.jsx)(_components.code, {
            className: "language-bash",
            children: "bun add --dev @repo-toolkit/confluence\n"
          })
        })
      })]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "cli",
      children: "CLI"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-confluence \\\n  --folder docs \\\n  --username user@example.com \\\n  --api-token-file /run/secrets/confluence_token \\\n  --confluence-base-url https://mydomain.atlassian.net/wiki \\\n  --space-key ENG \\\n  --parent-page-id 123456789\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "flags",
      children: "Flags"
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "Flag"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Description"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Default"
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--config <path>"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["JSON / ", (0,jsx_runtime.jsx)(_components.code, {
              children: ".mjs"
            }), " / ", (0,jsx_runtime.jsx)(_components.code, {
              children: ".cjs"
            }), " config file. CLI flags override config for the same option; env fills gaps; see ", (0,jsx_runtime.jsx)(_components.a, {
              href: "#configuration-precedence",
              children: "precedence"
            }), "."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "—"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--cwd <path>"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Working directory; ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--folder"
            }), " and secret-file paths resolve against this."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "process.cwd()"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--folder <path>"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Folder containing the documentation to publish (required, unless ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--interactive"
            }), " collects it)."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "—"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--username <value>"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Confluence username or email (required)."
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "—"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--api-token <value>"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Confluence API token (required). Alias: ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--password"
            }), ". Prefer a secret file; see ", (0,jsx_runtime.jsx)(_components.a, {
              href: "#credentials",
              children: "credentials"
            }), "."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "—"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--api-token-file <path>"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["File whose contents become the API token (one trailing newline + surrounding whitespace stripped). Alias: ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--password-file"
            }), ". Resolved relative to ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--cwd"
            }), "."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "—"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--confluence-base-url <url>"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Confluence URL with ", (0,jsx_runtime.jsx)(_components.code, {
              children: "/wiki"
            }), " (required). Alias: ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--base-url"
            }), "."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "—"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--space-key <key>"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Confluence space key (required; resolved to a ", (0,jsx_runtime.jsx)(_components.code, {
              children: "spaceId"
            }), " via the API)."]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "—"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--parent-page-id <id>"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Numeric page id under which docs are published (required)."
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "—"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--version-message <text>"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Version-message suffix appended to every page/attachment PUT."
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "Synced via repo-toolkit-confluence"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--skip-unchanged"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Skip pages whose body is unchanged."
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "true"
            }), " (skip)"]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--no-skip-unchanged"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Re-upload every page even when unchanged."
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "—"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--dry-run"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Walk the doc tree and run the same local preflight (read + convert every markdown file, validate every local image source) then print the plan. No API mutation calls; bypasses required-field checks so no credentials are needed."
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--render-html-blocks"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Render ", (0,jsx_runtime.jsx)(_components.code, {
              children: "```html"
            }), " fenced blocks as inline HTML via the Confluence ", (0,jsx_runtime.jsx)(_components.code, {
              children: "html"
            }), " macro instead of a code box. ", (0,jsx_runtime.jsx)(_components.strong, {
              children: "Unsafe for untrusted Markdown."
            })]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "-i, --interactive"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Prompt on a real TTY for missing non-secret required fields. The API token is never prompted."
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "-h, --help"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Show help and return."
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "—"
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "configuration-precedence",
      children: "Configuration precedence"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Every option is resolved ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "independently"
      }), " in this order, with later sources\noverriding earlier ones only for the option they supply:"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.ol, {
      children: ["\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "CLI flag for that option"
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "--config"
        }), " file value for that option"]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "CONFLUENCE_*"
        }), " environment variable for that option (higher specificity)"]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "INPUT_*"
        }), " environment variable for that option (GitHub Actions form)"]
      }), "\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "built-in default"
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Supplying ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--api-token"
      }), " (or any other flag) does ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "not"
      }), " disable environment\nresolution for the options you left unset. You can keep credentials in the\nenvironment and still override, say, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--folder"
      }), " on the command line. The merged\noptions are computed as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{ ...envOptions, ...config, ...cliOptions }"
      }), ", so CLI\nwins per-option, config wins over env per-option, and env fills gaps left by\nboth."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "environment-variables",
      children: "Environment variables"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "CONFLUENCE_*"
      }), " (higher specificity) and the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "INPUT_*"
      }), " GitHub Actions form are\nboth read for every option. Boolean env values accept ", (0,jsx_runtime.jsx)(_components.code, {
        children: "true|1|yes|on"
      }), " /\n", (0,jsx_runtime.jsx)(_components.code, {
        children: "false|0|no|off"
      }), " (the empty string is falsy); any other value exits nonzero\nwith ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Invalid boolean value for <ENV_NAME>: <raw>. Use one of true|false|1|0|yes|no|on|off."
      }), " naming the offending variable and value."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "Option"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CONFLUENCE_*"
            })
          }), (0,jsx_runtime.jsxs)(_components.th, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_*"
            }), " (Actions form)"]
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "folder"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CONFLUENCE_FOLDER"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_FOLDER"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "username"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CONFLUENCE_USERNAME"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_USERNAME"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "apiToken"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CONFLUENCE_API_TOKEN"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_API-TOKEN"
            }), ", ", (0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_PASSWORD"
            })]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "apiTokenFile"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CONFLUENCE_API_TOKEN_FILE"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_API-TOKEN-FILE"
            }), ", ", (0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_PASSWORD-FILE"
            })]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "baseUrl"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CONFLUENCE_BASE_URL"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_CONFLUENCE-BASE-URL"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "spaceKey"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CONFLUENCE_SPACE_KEY"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_SPACE-KEY"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "parentPageId"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CONFLUENCE_PARENT_PAGE_ID"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_PARENT-PAGE-ID"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "versionMessage"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CONFLUENCE_VERSION_MESSAGE"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_VERSION-MESSAGE"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "skipUnchanged (bool)"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CONFLUENCE_SKIP_UNCHANGED"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_SKIP-UNCHANGED"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "dryRun (bool)"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CONFLUENCE_DRY_RUN"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_DRY-RUN"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "renderHtmlBlocks (bool)"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CONFLUENCE_RENDER_HTML_BLOCKS"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "INPUT_RENDER-HTML-BLOCKS"
            })
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "CONFLUENCE_*"
      }), " takes precedence over the lower-specificity ", (0,jsx_runtime.jsx)(_components.code, {
        children: "INPUT_*"
      }), " form, so\nnon-Action users can supply env credentials with documented semantics while\nthe existing ", (0,jsx_runtime.jsx)(_components.code, {
        children: "INPUT_*"
      }), " contract for GitHub Actions continues to work."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "credentials",
      children: "Credentials"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Authentication uses HTTP Basic with an ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "API token"
      }), ", not your account\npassword. Three input paths exist, in order of recommendation:"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.ol, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.strong, {
          children: "Secret file"
        }), " — ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--api-token-file <path>"
        }), " (", (0,jsx_runtime.jsx)(_components.code, {
          children: "--password-file"
        }), "), the\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "apiTokenFile"
        }), " config key, or ", (0,jsx_runtime.jsx)(_components.code, {
          children: "CONFLUENCE_API_TOKEN_FILE"
        }), " /\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "INPUT_API-TOKEN-FILE"
        }), " / ", (0,jsx_runtime.jsx)(_components.code, {
          children: "INPUT_PASSWORD-FILE"
        }), " env. The file is read into\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "apiToken"
        }), "; one trailing newline and surrounding whitespace are stripped.\nAn empty file fails with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "apiTokenFile at <path> is empty."
        }), "; an unreadable\nfile fails with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "Failed to read apiTokenFile at <path>"
        }), " (the underlying fs\nerror is preserved on ", (0,jsx_runtime.jsx)(_components.code, {
          children: "Error.cause"
        }), " — ", (0,jsx_runtime.jsx)(_components.code, {
          children: "target: ES2018"
        }), " precludes the\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "new Error(m, { cause })"
        }), " constructor form). Secret-file paths resolve\nrelative to ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--cwd"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.strong, {
          children: "Environment variable"
        }), " — ", (0,jsx_runtime.jsx)(_components.code, {
          children: "CONFLUENCE_API_TOKEN"
        }), " (preferred) or\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "INPUT_API-TOKEN"
        }), " / ", (0,jsx_runtime.jsx)(_components.code, {
          children: "INPUT_PASSWORD"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.strong, {
          children: "CLI flag"
        }), " — ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--api-token <value>"
        }), " (", (0,jsx_runtime.jsx)(_components.code, {
          children: "--password"
        }), "). The least safe option\nbecause the value is visible in argv and process listings; prefer one of\nthe above."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["An explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--api-token"
      }), " (or env-supplied token) ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "wins"
      }), " over the file: if\nboth are present, the file is not read. An interactive session with no token\nthrows ", (0,jsx_runtime.jsx)(_components.code, {
        children: "apiToken is required. Provide it via --api-token-file, INPUT_API-TOKEN-FILE, CONFLUENCE_API_TOKEN_FILE, or the CONFLUENCE_API_TOKEN / INPUT_API-TOKEN environment variable. Tokens are never prompted interactively to avoid entering them on screen."
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "--help"
      }), ", errors, and all log lines never print the supplied token value."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "--interactive",
      children: (0,jsx_runtime.jsx)(_components.code, {
        children: "--interactive"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Neither inert nor global. Resolution:"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Only effective when ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--interactive"
        }), " is set, ", (0,jsx_runtime.jsx)(_components.code, {
          children: "canPrompt()"
        }), " is true (real\nTTY, not piped input), and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--dry-run"
        }), " is not set."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Collects missing ", (0,jsx_runtime.jsx)(_components.strong, {
          children: "non-secret"
        }), " required fields only: ", (0,jsx_runtime.jsx)(_components.code, {
          children: "folder"
        }), ",\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "username"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "baseUrl"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "spaceKey"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "parentPageId"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["The API token is ", (0,jsx_runtime.jsx)(_components.strong, {
          children: "never"
        }), " prompted interactively. An interactive session\nwith no token throws the credential error above instead of asking."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Without ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--interactive"
      }), ", missing required fields short-circuit with a precise\nfield-level error before the Confluence client is built."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "raw-html-and-security",
      children: "Raw HTML and security"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "The Markdown → Confluence storage-format pipeline entity-escapes all inline\nHTML by default. The only places raw markup lands in the page body are:"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ol, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.strong, {
          children: "Fenced code blocks"
        }), " (", (0,jsx_runtime.jsx)(_components.code, {
          children: "```lang"
        }), ") — emitted as a Confluence ", (0,jsx_runtime.jsx)(_components.code, {
          children: "code"
        }), "\nstructured macro whose plain-text body is wrapped in a CDATA section. The\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "]]>"
        }), " CDATA terminator is neutralized (", (0,jsx_runtime.jsx)(_components.code, {
          children: "]]>"
        }), " → ", (0,jsx_runtime.jsx)(_components.code, {
          children: "]]]]><![CDATA[>"
        }), ") so block\ncontents cannot escape the macro. This is safe for arbitrary content\nbecause the macro renders text, not active markup."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.strong, {
          children: "HTML fenced blocks"
        }), " when ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--render-html-blocks"
        }), " is on — emitted as an\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "ac:structured-macro ac:name=\"html\""
        }), " body. The Confluence ", (0,jsx_runtime.jsx)(_components.code, {
          children: "html"
        }), " macro\n", (0,jsx_runtime.jsx)(_components.strong, {
          children: "executes the raw markup"
        }), ", so this path is an active-content boundary.\n", (0,jsx_runtime.jsxs)(_components.strong, {
          children: ["Do not feed untrusted Markdown through ", (0,jsx_runtime.jsx)(_components.code, {
            children: "--render-html-blocks"
          }), "."]
        }), " The\ndefault (", (0,jsx_runtime.jsx)(_components.code, {
          children: "false"
        }), ") emits HTML fenced blocks as a ", (0,jsx_runtime.jsx)(_components.code, {
          children: "code"
        }), " macro instead, which\nis safe."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The package deliberately does not ship a sanitization layer for raw HTML\nblocks: the safe-by-default stance is ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--render-html-blocks"
      }), " off, and the\nunsafe opt-in is documented as such. If you cannot trust your Markdown input,\nleave ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--render-html-blocks"
      }), " off."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Inline link and image URLs are validated against an ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "allowlist"
      }), ", not a\nblocklist. Only ", (0,jsx_runtime.jsx)(_components.code, {
        children: "http"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "https"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "mailto"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tel"
      }), " schemes, plus scheme-less\nprotocol-relative (", (0,jsx_runtime.jsx)(_components.code, {
        children: "//host"
      }), "), server-relative (", (0,jsx_runtime.jsx)(_components.code, {
        children: "/path"
      }), "), and pure-relative\n(", (0,jsx_runtime.jsx)(_components.code, {
        children: "path"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "#frag"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "?query"
      }), ") URLs are rendered as links/images. Every other\nscheme — ", (0,jsx_runtime.jsx)(_components.code, {
        children: "javascript:"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "data:"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "file:"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "vbscript:"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "blob:"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "myapp:"
      }), ",\ncustom app schemes, etc. — is rejected and the link/image collapses to its\nlabel/alt text. URLs containing C0/DEL control characters (NUL, TAB, CR, LF,\nBEL, DEL, …) are rejected, defeating ", (0,jsx_runtime.jsx)(_components.code, {
        children: "java\\tscript:"
      }), "-style obfuscation.\nPercent-encoded blocked schemes (e.g. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "java%73cript:"
      }), ") are decoded before the\nscheme check and rejected. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "&"
      }), " in a URL attribute is escaped to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "&"
      }), " so the\ngenerated ", (0,jsx_runtime.jsx)(_components.code, {
        children: "href"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "ri:value"
      }), " remains XML-valid."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "supported-markdown",
      children: "Supported Markdown"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "A focused subset of CommonMark is converted to Confluence storage format.\nFeatures not in this list are passed through as paragraphs (escaped), not\ntreated specially."
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["ATX headings (", (0,jsx_runtime.jsx)(_components.code, {
          children: "#"
        }), " through ", (0,jsx_runtime.jsx)(_components.code, {
          children: "######"
        }), ")"]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Paragraphs, with hard line breaks (", (0,jsx_runtime.jsx)(_components.code, {
          children: "<br />"
        }), ") within a paragraph"]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Unordered lists (", (0,jsx_runtime.jsx)(_components.code, {
          children: "-"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "*"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "+"
        }), ") and ordered lists (", (0,jsx_runtime.jsx)(_components.code, {
          children: "1."
        }), ")"]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Blockquotes (", (0,jsx_runtime.jsx)(_components.code, {
          children: ">"
        }), ")"]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Thematic breaks (", (0,jsx_runtime.jsx)(_components.code, {
          children: "---"
        }), " / ", (0,jsx_runtime.jsx)(_components.code, {
          children: "***"
        }), ")"]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Fenced code blocks (", (0,jsx_runtime.jsx)(_components.code, {
          children: "```lang"
        }), "), emitted as a Confluence ", (0,jsx_runtime.jsx)(_components.code, {
          children: "code"
        }), " macro.\nUnknown languages are tagged ", (0,jsx_runtime.jsx)(_components.code, {
          children: "language=none"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Inline: ", (0,jsx_runtime.jsx)(_components.code, {
          children: "**strong**"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "__strong__"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "*em*"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "_em_"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "`code`"
        })]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Inline code spans are tokenized ", (0,jsx_runtime.jsx)(_components.strong, {
          children: "first"
        }), " and their contents are never\nprocessed as Markdown or re-escaped; ", (0,jsx_runtime.jsx)(_components.code, {
          children: "*not italic*"
        }), " inside ", (0,jsx_runtime.jsx)(_components.code, {
          children: "` `"
        }), " stays\nliteral. Backtick-run-length matching (", (0,jsx_runtime.jsx)(_components.code, {
          children: "`x`"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: " `a`b"
        }), " ", (0,jsx_runtime.jsx)(_components.code, {
          children: ") follows CommonMark, and a single leading/trailing space inside a span is trimmed ("
        }), " ", (0,jsx_runtime.jsx)(_components.code, {
          children: "code"
        }), "→", (0,jsx_runtime.jsx)(_components.code, {
          children: "<code>code</code>"
        }), " ``)."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Emphasis is matched with CommonMark flanking rules. ", (0,jsx_runtime.jsx)(_components.code, {
          children: "*"
        }), " allows intraword\nemphasis (", (0,jsx_runtime.jsx)(_components.code, {
          children: "a*b*c"
        }), "); ", (0,jsx_runtime.jsx)(_components.code, {
          children: "_"
        }), " does not (", (0,jsx_runtime.jsx)(_components.code, {
          children: "snake_case_name"
        }), " is literal, not\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "snake<em>case</em>name"
        }), "). Nested emphasis works:\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "**a *b* c** → <strong>a <em>b</em> c</strong>"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Backslash escapes work for ASCII punctuation: ", (0,jsx_runtime.jsx)(_components.code, {
          children: "\\*"
        }), " → ", (0,jsx_runtime.jsx)(_components.code, {
          children: "*"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "\\_"
        }), " → ", (0,jsx_runtime.jsx)(_components.code, {
          children: "_"
        }), ",\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "\\["
        }), " → ", (0,jsx_runtime.jsx)(_components.code, {
          children: "["
        }), ", etc., so escaped markers cannot open/close emphasis or links."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Links ", (0,jsx_runtime.jsx)(_components.code, {
          children: "[text](url)"
        }), " and images ", (0,jsx_runtime.jsx)(_components.code, {
          children: "![alt](src)"
        }), " parse URLs across ", (0,jsx_runtime.jsx)(_components.strong, {
          children: "balanced\nnested parentheses"
        }), " (", (0,jsx_runtime.jsx)(_components.code, {
          children: "[wiki](https://en/Foo_(bar))"
        }), ") and recursively render\nthe label (so ", (0,jsx_runtime.jsx)(_components.code, {
          children: "[*em* **strong**](url)"
        }), " works). URLs are validated against\nthe allowlist above."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Local images (", (0,jsx_runtime.jsx)(_components.code, {
          children: "![alt](relative.png)"
        }), ") become ", (0,jsx_runtime.jsx)(_components.code, {
          children: "<ac:image data-local-src=\"...\">"
        }), " placeholders that are rewritten to attachment macros\nafter upload. Remote images (", (0,jsx_runtime.jsx)(_components.code, {
          children: "http(s)://"
        }), " / protocol-relative ", (0,jsx_runtime.jsx)(_components.code, {
          children: "//"
        }), ") stay as\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "<ac:image><ri:url />"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["YAML front matter (", (0,jsx_runtime.jsx)(_components.code, {
          children: "---"
        }), " … ", (0,jsx_runtime.jsx)(_components.code, {
          children: "---"
        }), "/", (0,jsx_runtime.jsx)(_components.code, {
          children: "..."
        }), ") is stripped from the top of each\nfile before conversion."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Beyond the Markdown subset, fenced ", (0,jsx_runtime.jsx)(_components.code, {
        children: "```mermaid"
      }), " blocks are rendered to SVG\nand uploaded as attachments when ", (0,jsx_runtime.jsx)(_components.code, {
        children: "mmdc"
      }), " is available (see below), otherwise\nemitted as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "code"
      }), " macros."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Tables, footnotes, task lists, definition lists, HTML inline, and raw HTML\noutside fenced blocks are ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "not"
      }), " in the supported subset."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "mermaid",
      children: "Mermaid"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "```mermaid"
      }), " fenced blocks are turned inline as an ", (0,jsx_runtime.jsx)(_components.code, {
        children: "<ac:image>"
      }), " macro\npointing at an SVG attachment on the page, when:"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["The ", (0,jsx_runtime.jsx)(_components.code, {
          children: "mmdc"
        }), " (mermaid-cli) binary is discoverable on ", (0,jsx_runtime.jsx)(_components.code, {
          children: "PATH"
        }), ", or"]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "renderHook"
        }), "/", (0,jsx_runtime.jsx)(_components.code, {
          children: "available"
        }), " is supplied programmatically (testing path)."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["If ", (0,jsx_runtime.jsx)(_components.code, {
        children: "mmdc"
      }), " is unavailable, or rendering fails, or the produced file is empty or\nnot a valid SVG, the block ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "falls back"
      }), " to a Confluence ", (0,jsx_runtime.jsx)(_components.code, {
        children: "code"
      }), " macro with\nthe original mermaid source, and a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "mermaid: N block(s) not rendered (mmdc unavailable or failed); emitted as code macros"
      }), " line is logged. Existing\nattachments with the same filename are updated in place (new version number)\ninstead of duplicated."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Per-render settings (", (0,jsx_runtime.jsx)(_components.code, {
        children: "renderTimeoutMs"
      }), " default 30 000 ms, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "maxStreamBytes"
      }), "\ndefault 1 MiB) bound a misbehaving ", (0,jsx_runtime.jsx)(_components.code, {
        children: "mmdc"
      }), " subprocess. There is no in-process\nmermaid renderer; if you want diagrams rendered, install ", (0,jsx_runtime.jsx)(_components.code, {
        children: "@mermaid-js/mermaid-cli"
      }), "\nin the action runner or CI image."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "optimistic-concurrency",
      children: "Optimistic concurrency"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Page writes use Confluence's optimistic concurrency model:"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Before each PUT, the current page is fetched and the next version is\ncomputed as ", (0,jsx_runtime.jsx)(_components.code, {
          children: "version.number = current + 1"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["The PUT supplies that ", (0,jsx_runtime.jsx)(_components.code, {
          children: "version.number"
        }), ", so a concurrent edit between the\nfetch and the PUT makes the server reject the write with ", (0,jsx_runtime.jsx)(_components.strong, {
          children: "HTTP 409"
        }), ". The\nclient surfaces this as ", (0,jsx_runtime.jsx)(_components.code, {
          children: "ConfluenceApiError"
        }), " with a ", (0,jsx_runtime.jsx)(_components.code, {
          children: "version conflict"
        }), "\nmessage and does not silently retry writes (retries apply only to safe\nmethods — GET/HEAD/OPTIONS — on 429/5xx)."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "--skip-unchanged"
        }), " (default on) avoids a PUT when the page body is already\nidentical to the local render. The comparison is byte-equal on the produced\nstorage-format HTML."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Because writes are versioned, two sync processes editing the same page cannot\nsilently clobber each other: the loser gets a 409 and exits nonzero. There is\nno built-in retry-on-conflict policy; rerun the sync to reconcile."
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "additive-non-pruning-sync",
      children: "Additive (non-pruning) sync"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Sync is strictly additive with respect to Confluence: it only creates pages\nthat do not yet exist and updates the body of pages it can map. It ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "never\ndeletes"
      }), " Confluence pages or attachments that are absent locally. Removing a\nfile from your docs folder will not remove the corresponding Confluence page;\nyou must delete it in Confluence yourself."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["This is intentional for docs-as-code: most teams want edits made directly in\nConfluence (sibling pages, free-form notes) to survive a sync. The trade-off\nis that the local tree is not the source of truth for ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "removal"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "A few other reconciliation rules:"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["The local tree is hashed by ", (0,jsx_runtime.jsx)(_components.strong, {
          children: "page title under parent"
        }), ": collisions between a\nfile-page and a folder-page with the same title under the same parent are\nrejected up front with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "Local documentation tree contains conflicting page titles under the same parent: <title>"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["If two Confluence pages match a title under the same parent, sync throws\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "Multiple Confluence pages matched title <title> under parent <parentId>"
        }), "\nrather than guessing."]
      }), "\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "Pages are cached per space+title+parent within a single sync run; the cache\nis not persisted, so cross-sync concurrency is governed by the 409 path\nabove."
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "javascript-api",
      children: "JavaScript API"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import { syncConfluenceToDocs, resolveConfluenceSyncPlan, ConfluenceClient } from '@repo-toolkit/confluence';\n\n// resolveConfluenceSyncPlan validates options without starting a sync:\nconst plan = resolveConfluenceSyncPlan({\n  folder: 'docs',\n  username: 'user@example.com',\n  apiToken: process.env.CONFLUENCE_API_TOKEN!,\n  baseUrl: 'https://mydomain.atlassian.net/wiki',\n  spaceKey: 'ENG',\n  parentPageId: '123456789',\n});\n\nawait syncConfluenceToDocs({ ...plan, renderHtmlBlocks: false });\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "custom-gateway-typed-testing--non-confluence-backends",
      children: "Custom gateway (typed testing / non-Confluence backends)"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "syncConfluenceToDocs"
      }), " and the lower-level rewriters depend only on the narrow\n", (0,jsx_runtime.jsx)(_components.code, {
        children: "ConfluenceGateway"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "AttachmentGateway"
      }), " interfaces — they never read\n", (0,jsx_runtime.jsx)(_components.code, {
        children: "ConfluenceClient"
      }), " directly. Supply your own object whose method shapes match\nthe interface and the bundled HTTP credentials/baseUrl are no longer required:\nthe gateway owns all remote work."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import { syncConfluenceToDocs, type ConfluenceGateway } from '@repo-toolkit/confluence';\n\n// A typed fake: no `as unknown as ConfluenceClient` cast needed.\nconst fake: ConfluenceGateway = {\n  async getSpaceIdByKey() {\n    return 'SPACE';\n  },\n  async getPagesByTitle(_spaceId, _title) {\n    return [];\n  },\n  async getPage() {\n    throw new Error('not stubbed');\n  },\n  async createPage(input) {\n    return {\n      /* … */\n    } as never;\n  },\n  async updatePage(input) {\n    return {\n      /* … */\n    } as never;\n  },\n  async getAttachments() {\n    return [];\n  },\n  async uploadAttachment() {\n    throw new Error('not stubbed');\n  },\n  async updateAttachmentData() {\n    throw new Error('not stubbed');\n  },\n};\n\nawait syncConfluenceToDocs({\n  folder: 'docs',\n  spaceKey: 'ENG',\n  parentPageId: '123',\n  client: fake, // ← skips username / apiToken / baseUrl checks\n  log: () => {},\n});\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "spaceKey"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "parentPageId"
      }), " remain required even with a custom gateway —\nthe orchestrator needs them to drive the gateway, and a custom client doesn't\nknow which Confluence space or parent page to publish under. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--dry-run"
      }), "\nremains credentials-free (no gateway needed)."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "exports",
      children: "Exports"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "syncConfluenceToDocs(options)"
        }), " — walk the doc tree and sync pages,\nattachments, and mermaid blocks."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "resolveConfluenceSyncPlan(options)"
        }), " — resolve and validate the sync plan\n(", (0,jsx_runtime.jsx)(_components.code, {
          children: "ConfluenceSyncPlan"
        }), ") without starting a sync. Useful for previewing\ndefaults."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "ConfluenceClient"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "ConfluenceApiError"
        }), " — the bundled HTTP client. Page/\nspace/attachment-list calls use the v2 API; binary attachment uploads use\nthe v1 multipart endpoint with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "X-Atlassian-Token: no-check"
        }), " because v2 has\nno multipart contract yet."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "ConfluenceGateway"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "AttachmentGateway"
        }), " — narrow remote-mutation\ninterfaces that ", (0,jsx_runtime.jsx)(_components.code, {
          children: "ConfluenceClient"
        }), " implements. Both the orchestrator and\nthe image/mermaid rewriters depend only on these contracts, so a typed fake\nimplementing the gateway is accepted by ", (0,jsx_runtime.jsx)(_components.code, {
          children: "syncConfluenceToDocs({ client })"
        }), "\nand the rewriters without ", (0,jsx_runtime.jsx)(_components.code, {
          children: "as unknown as"
        }), " casts. Supplying ", (0,jsx_runtime.jsx)(_components.code, {
          children: "client"
        }), " skips\nthe bundled-client credential/baseUrl required-field checks."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "markdownToStorage(markdown, options)"
        }), " — the standalone Markdown →\nConfluence storage-format converter. Returns ", (0,jsx_runtime.jsx)(_components.code, {
          children: "{ html, mermaidBlocks }"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "escapeXmlAttribute"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "escapeAttachmentFilename"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "isRemoteUrl"
        }), ",\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "isAllowedUrl"
        }), " — converter building blocks for custom pipelines.\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "isAllowedUrl"
        }), " exposes the inline link/image URL allowlist\n(", (0,jsx_runtime.jsx)(_components.code, {
          children: "http"
        }), "/", (0,jsx_runtime.jsx)(_components.code, {
          children: "https"
        }), "/", (0,jsx_runtime.jsx)(_components.code, {
          children: "mailto"
        }), "/", (0,jsx_runtime.jsx)(_components.code, {
          children: "tel"
        }), " + scheme-less relative) so custom pipelines\ncan validate against the same policy."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "rewriteImagesToAttachments"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "rewriteMermaidBlocks"
        }), " — second-pass rewriters\nthat turn ", (0,jsx_runtime.jsx)(_components.code, {
          children: "<ac:image data-local-src>"
        }), " placeholders into attachment macros\nand mermaid placeholders into ", (0,jsx_runtime.jsx)(_components.code, {
          children: "mmdc"
        }), "-rendered SVG attachments."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "readDocTree"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "titleFromSegment"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "isMarkdownName"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "DocEntry"
        }), ",\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "DocTree"
        }), " — the local documentation-tree reader used by the sync."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "github-action-usage",
      children: "GitHub Action usage"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The CLI auto-detects the GitHub Actions ", (0,jsx_runtime.jsx)(_components.code, {
        children: "INPUT_*"
      }), " environment when no flags are\nsupplied. Bundle the ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "CLI entrypoint"
      }), " (", (0,jsx_runtime.jsx)(_components.code, {
        children: "src/cli.ts"
      }), ") — not the library entry\n(", (0,jsx_runtime.jsx)(_components.code, {
        children: "src/index.ts"
      }), ") — and ship the resulting ", (0,jsx_runtime.jsx)(_components.code, {
        children: "dist/cli.js"
      }), " as the action main.\n", (0,jsx_runtime.jsx)(_components.code, {
        children: "tsup"
      }), " emits the CLI as a separate entry with a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "#!/usr/bin/env node"
      }), " banner;\n", (0,jsx_runtime.jsx)(_components.code, {
        children: "@vercel/ncc"
      }), " callers point at ", (0,jsx_runtime.jsx)(_components.code, {
        children: "src/cli.ts"
      }), " directly."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "# with @vercel/ncc\nncc build packages/confluence/src/cli.ts -o action-dist\n# ships action-dist/index.js — reference it as the action main\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Example ", (0,jsx_runtime.jsx)(_components.code, {
        children: "action.yml"
      }), ":"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-yaml",
        children: "runs:\n  using: 'node20'\n  main: 'action-dist/index.js'\ninputs:\n  folder: { required: true }\n  username: { required: true }\n  password: { required: true }\n  password-file: { required: false }\n  confluence-base-url: { required: true }\n  space-key: { required: true }\n  parent-page-id: { required: true }\n  version-message: { required: false }\n  dry-run: { required: false, default: 'false' }\n  skip-unchanged: { required: false, default: 'true' }\n  render-html-blocks: { required: false, default: 'false' }\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["A runnable smoke fixture lives under\n", (0,jsx_runtime.jsx)(_components.a, {
        href: "https://github.com/egose/repo-toolkit/blob/main/packages/confluence/action-fixture",
        children: (0,jsx_runtime.jsx)(_components.code, {
          children: "packages/confluence/action-fixture"
        })
      }), "\nand demonstrates starting a sync with mocked ", (0,jsx_runtime.jsx)(_components.code, {
        children: "INPUT_*"
      }), " inputs and no network,\nso an Action runner can confirm the bundle wires the CLI to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "INPUT_*"
      }), " inputs\nend-to-end."]
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

/***/ 6574
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: () => (/* binding */ TabItem)
});

// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/index.js
var react = __webpack_require__(489);
// EXTERNAL MODULE: ./node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
var clsx = __webpack_require__(3526);
// EXTERNAL MODULE: ./node_modules/.pnpm/@docusaurus+theme-common@3.10.1_@docusaurus+plugin-content-docs@3.10.1_@mdx-js+react@3._5c760eb0e2d5ff300251aa280f7f631a/node_modules/@docusaurus/theme-common/lib/utils/tabsUtils.js
var tabsUtils = __webpack_require__(2329);
;// ./node_modules/.pnpm/@docusaurus+theme-classic@3.10.1_@types+react@19.2.14_react-dom@19.2.6_react@19.2.6__react@19.2.6_typescript@6.0.3/node_modules/@docusaurus/theme-classic/lib/theme/TabItem/styles.module.css
// extracted by mini-css-extract-plugin
/* harmony default export */ const styles_module = ({"tabItem":"tabItem_WPJy"});
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(1325);
;// ./node_modules/.pnpm/@docusaurus+theme-classic@3.10.1_@types+react@19.2.14_react-dom@19.2.6_react@19.2.6__react@19.2.6_typescript@6.0.3/node_modules/@docusaurus/theme-classic/lib/theme/TabItem/index.js
/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */function TabItemPanel({children,className,hidden}){return/*#__PURE__*/(0,jsx_runtime.jsx)("div",{role:"tabpanel",className:(0,clsx/* default */.A)(styles_module.tabItem,className),hidden,children:children});}function TabItem({children,className,value}){const{selectedValue,lazy}=(0,tabsUtils/* useTabs */.uc)();const isSelected=value===selectedValue;// TODO Docusaurus v4: use <Activity> ?
if(!isSelected&&lazy){return null;}return/*#__PURE__*/(0,jsx_runtime.jsx)(TabItemPanel,{className:className,hidden:!isSelected,children:children});}

/***/ },

/***/ 5250
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {


// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  A: () => (/* binding */ Tabs)
});

// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/index.js
var react = __webpack_require__(489);
// EXTERNAL MODULE: ./node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
var clsx = __webpack_require__(3526);
// EXTERNAL MODULE: ./node_modules/.pnpm/@docusaurus+theme-common@3.10.1_@docusaurus+plugin-content-docs@3.10.1_@mdx-js+react@3._5c760eb0e2d5ff300251aa280f7f631a/node_modules/@docusaurus/theme-common/lib/utils/ThemeClassNames.js
var ThemeClassNames = __webpack_require__(1905);
// EXTERNAL MODULE: ./node_modules/.pnpm/@docusaurus+theme-common@3.10.1_@docusaurus+plugin-content-docs@3.10.1_@mdx-js+react@3._5c760eb0e2d5ff300251aa280f7f631a/node_modules/@docusaurus/theme-common/lib/utils/tabsUtils.js
var tabsUtils = __webpack_require__(2329);
// EXTERNAL MODULE: ./node_modules/.pnpm/@docusaurus+theme-common@3.10.1_@docusaurus+plugin-content-docs@3.10.1_@mdx-js+react@3._5c760eb0e2d5ff300251aa280f7f631a/node_modules/@docusaurus/theme-common/lib/utils/scrollUtils.js
var scrollUtils = __webpack_require__(4714);
// EXTERNAL MODULE: ./node_modules/.pnpm/@docusaurus+core@3.10.1_@mdx-js+react@3.1.1_@types+react@19.2.14_react@19.2.6__postcss@_8e4f15980c67c89e41a59896d33471aa/node_modules/@docusaurus/core/lib/client/exports/useIsBrowser.js
var useIsBrowser = __webpack_require__(2288);
;// ./node_modules/.pnpm/@docusaurus+theme-classic@3.10.1_@types+react@19.2.14_react-dom@19.2.6_react@19.2.6__react@19.2.6_typescript@6.0.3/node_modules/@docusaurus/theme-classic/lib/theme/Tabs/styles.module.css
// extracted by mini-css-extract-plugin
/* harmony default export */ const styles_module = ({"tabList":"tabList_Ardb","tabItem":"tabItem_astB"});
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(1325);
;// ./node_modules/.pnpm/@docusaurus+theme-classic@3.10.1_@types+react@19.2.14_react-dom@19.2.6_react@19.2.6__react@19.2.6_typescript@6.0.3/node_modules/@docusaurus/theme-classic/lib/theme/Tabs/index.js
/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */function TabList({className}){const{selectedValue,selectValue,tabValues,block}=(0,tabsUtils/* useTabs */.uc)();const tabRefs=[];const{blockElementScrollPositionUntilNextRender}=(0,scrollUtils/* useScrollPositionBlocker */.a_)();const handleTabChange=event=>{const newTab=event.currentTarget;const newTabIndex=tabRefs.indexOf(newTab);const newTabValue=tabValues[newTabIndex].value;if(newTabValue!==selectedValue){blockElementScrollPositionUntilNextRender(newTab);selectValue(newTabValue);}};const handleKeydown=event=>{let focusElement=null;switch(event.key){case'Enter':{handleTabChange(event);break;}case'ArrowRight':{const nextTab=tabRefs.indexOf(event.currentTarget)+1;focusElement=tabRefs[nextTab]??tabRefs[0];break;}case'ArrowLeft':{const prevTab=tabRefs.indexOf(event.currentTarget)-1;focusElement=tabRefs[prevTab]??tabRefs[tabRefs.length-1];break;}default:break;}focusElement?.focus();};return/*#__PURE__*/(0,jsx_runtime.jsx)("ul",{role:"tablist","aria-orientation":"horizontal",className:(0,clsx/* default */.A)('tabs',{'tabs--block':block},className),children:tabValues.map(({value,label,attributes})=>/*#__PURE__*/(0,jsx_runtime.jsx)("li",{// TODO extract TabListItem
role:"tab",tabIndex:selectedValue===value?0:-1,"aria-selected":selectedValue===value,ref:ref=>{tabRefs.push(ref);},onKeyDown:handleKeydown,onClick:handleTabChange,...attributes,className:(0,clsx/* default */.A)('tabs__item',styles_module.tabItem,attributes?.className,{'tabs__item--active':selectedValue===value}),children:label??value},value))});}function TabContent({children}){return/*#__PURE__*/(0,jsx_runtime.jsx)("div",{className:"margin-top--md",children:children});}function TabsContainer({className,children}){return/*#__PURE__*/(0,jsx_runtime.jsxs)("div",{className:(0,clsx/* default */.A)(ThemeClassNames/* ThemeClassNames */.G.tabs.container,// former name kept for backward compatibility
// see https://github.com/facebook/docusaurus/pull/4086
'tabs-container',styles_module.tabList),children:[/*#__PURE__*/(0,jsx_runtime.jsx)(TabList// Surprising but historical
// className is applied on TabList, not on TabsContainer
,{className:className}),/*#__PURE__*/(0,jsx_runtime.jsx)(TabContent,{children:children})]});}function Tabs(props){const isBrowser=(0,useIsBrowser/* default */.A)();const value=(0,tabsUtils/* useTabsContextValue */.OC)(props);return/*#__PURE__*/(0,jsx_runtime.jsx)(tabsUtils/* TabsProvider */.O_,{value:value// Remount tabs after hydration
// Temporary fix for https://github.com/facebook/docusaurus/issues/5653
,children:/*#__PURE__*/(0,jsx_runtime.jsx)(TabsContainer,{className:props.className,children:(0,tabsUtils/* sanitizeTabsChildren */.vT)(props.children)})},String(isBrowser));}

/***/ },

/***/ 2329
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   OC: () => (/* binding */ useTabsContextValue),
/* harmony export */   O_: () => (/* binding */ TabsProvider),
/* harmony export */   uc: () => (/* binding */ useTabs),
/* harmony export */   vT: () => (/* binding */ sanitizeTabsChildren)
/* harmony export */ });
/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(489);
/* harmony import */ var _docusaurus_router__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(4510);
/* harmony import */ var _docusaurus_useIsomorphicLayoutEffect__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(8804);
/* harmony import */ var _docusaurus_theme_common_internal__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(9231);
/* harmony import */ var _index__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(5037);
/* harmony import */ var _index__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(7252);
/* harmony import */ var react_jsx_runtime__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(1325);
/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */function sanitizeTabsChildren(children){return react__WEBPACK_IMPORTED_MODULE_0__.Children.toArray(children).filter(child=>child!=='\n');}function extractChildrenTabValues(children){// ✅ <TabItem value="red"/> => true
// ✅ <CustomTabItem value="red"/> => true
// ❌ <RedTabItem value="tab-value"/> => requires <Tabs values> prop
function isTabItemWithValueProp(comp){const{props}=comp;return!!props&&typeof props==='object'&&'value'in props;}const elements=react__WEBPACK_IMPORTED_MODULE_0__.Children.toArray(children).flatMap(child=>{// Historical case, not sure when it happens, do we really need this?
if(!child){return[];}if(/*#__PURE__*/(0,react__WEBPACK_IMPORTED_MODULE_0__.isValidElement)(child)&&isTabItemWithValueProp(child)){return[child];}// child.type.name will give non-sensical values in prod because of
// minification, but we assume it won't throw in prod.
const badChildTypeName=// @ts-expect-error: guarding against unexpected cases
typeof child.type==='string'?child.type:child.type.name;throw new Error(`Docusaurus error: Bad <Tabs> child <${badChildTypeName}>: all children of the <Tabs> component should be <TabItem>, and every <TabItem> should have a unique "value" prop.
If you do not want to pass on a "value" prop to the direct children of <Tabs>, you can also pass an explicit <Tabs values={...}> prop.`);});return elements.map(({props:{value,label,attributes,default:isDefault}})=>({value,label,attributes,default:isDefault}));}function ensureNoDuplicateValue(values){const dup=(0,_index__WEBPACK_IMPORTED_MODULE_5__/* .duplicates */ .XI)(values,(a,b)=>a.value===b.value);if(dup.length>0){throw new Error(`Docusaurus error: Duplicate values "${dup.map(a=>`'${a.value}'`).join(', ')}" found in <Tabs>. Every value needs to be unique.`);}}function useTabValues(props){const{values:valuesProp,children}=props;return (0,react__WEBPACK_IMPORTED_MODULE_0__.useMemo)(()=>{const values=valuesProp??extractChildrenTabValues(children);ensureNoDuplicateValue(values);return values;},[valuesProp,children]);}function isValidValue({value,tabValues}){return tabValues.some(a=>a.value===value);}function getInitialStateValue({defaultValue,tabValues}){if(tabValues.length===0){throw new Error('Docusaurus error: the <Tabs> component requires at least one <TabItem> children component');}if(defaultValue){// Warn user about passing incorrect defaultValue as prop.
if(!isValidValue({value:defaultValue,tabValues})){throw new Error(`Docusaurus error: The <Tabs> has a defaultValue "${defaultValue}" but none of its children has the corresponding value. Available values are: ${tabValues.map(a=>a.value).join(', ')}. If you intend to show no default tab, use defaultValue={null} instead.`);}return defaultValue;}const defaultTabValue=tabValues.find(tabValue=>tabValue.default)??tabValues[0];if(!defaultTabValue){throw new Error('Unexpected error: 0 tabValues');}return defaultTabValue.value;}function getStorageKey(groupId){if(!groupId){return null;}return`docusaurus.tab.${groupId}`;}function getQueryStringKey({queryString=false,groupId}){if(typeof queryString==='string'){return queryString;}if(queryString===false){return null;}if(queryString===true&&!groupId){throw new Error(`Docusaurus error: The <Tabs> component groupId prop is required if queryString=true, because this value is used as the search param name. You can also provide an explicit value such as queryString="my-search-param".`);}return groupId??null;}function useTabQueryString({queryString=false,groupId}){const history=(0,_docusaurus_router__WEBPACK_IMPORTED_MODULE_1__/* .useHistory */ .W6)();const key=getQueryStringKey({queryString,groupId});const value=(0,_docusaurus_theme_common_internal__WEBPACK_IMPORTED_MODULE_3__/* .useQueryStringValue */ .aZ)(key);const setValue=(0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(newValue=>{if(!key){return;// no-op
}const searchParams=new URLSearchParams(history.location.search);searchParams.set(key,newValue);history.replace({...history.location,search:searchParams.toString()});},[key,history]);return[value,setValue];}function useTabStorage({groupId}){const key=getStorageKey(groupId);const[value,storageSlot]=(0,_index__WEBPACK_IMPORTED_MODULE_4__/* .useStorageSlot */ .Dv)(key);const setValue=(0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(newValue=>{if(!key){return;// no-op
}storageSlot.set(newValue);},[key,storageSlot]);return[value,setValue];}function useTabsContextValue(props){const{defaultValue,queryString=false,groupId}=props;const tabValues=useTabValues(props);const[selectedValue,setSelectedValue]=(0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(()=>getInitialStateValue({defaultValue,tabValues}));const[queryStringValue,setQueryString]=useTabQueryString({queryString,groupId});const[storageValue,setStorageValue]=useTabStorage({groupId});// We sync valid querystring/storage value to state on change + hydration
const valueToSync=(()=>{const value=queryStringValue??storageValue;if(!isValidValue({value,tabValues})){return null;}return value;})();// Sync in a layout/sync effect is important, for useScrollPositionBlocker
// See https://github.com/facebook/docusaurus/issues/8625
(0,_docusaurus_useIsomorphicLayoutEffect__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A)(()=>{if(valueToSync){setSelectedValue(valueToSync);}},[valueToSync]);const selectValue=(0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(newValue=>{if(!isValidValue({value:newValue,tabValues})){throw new Error(`Can't select invalid tab value=${newValue}`);}setSelectedValue(newValue);setQueryString(newValue);setStorageValue(newValue);},[setQueryString,setStorageValue,tabValues]);return{selectedValue,selectValue,tabValues,lazy:props.lazy??false,block:props.block??false};}const TabsContext=/*#__PURE__*/(0,react__WEBPACK_IMPORTED_MODULE_0__.createContext)(null);function useTabs(){const contextValue=react__WEBPACK_IMPORTED_MODULE_0__.useContext(TabsContext);if(!contextValue){throw new Error('useTabsContext() must be used within a Tabs component');}return contextValue;}function TabsProvider(props){return/*#__PURE__*/(0,react_jsx_runtime__WEBPACK_IMPORTED_MODULE_6__.jsx)(TabsContext.Provider,{value:props.value,children:props.children});}

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