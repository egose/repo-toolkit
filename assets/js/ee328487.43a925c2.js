"use strict";
(globalThis["webpackChunkwebsite"] = globalThis["webpackChunkwebsite"] || []).push([[861],{

/***/ 9835
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  assets: () => (/* binding */ assets),
  contentTitle: () => (/* binding */ contentTitle),
  "default": () => (/* binding */ MDXContent),
  frontMatter: () => (/* binding */ frontMatter),
  metadata: () => (/* reexport */ site_docs_packages_secret_sync_md_ee3_namespaceObject),
  toc: () => (/* binding */ toc)
});

;// ./.docusaurus/docusaurus-plugin-content-docs/default/site-docs-packages-secret-sync-md-ee3.json
const site_docs_packages_secret_sync_md_ee3_namespaceObject = /*#__PURE__*/JSON.parse('{"id":"packages/secret-sync","title":"@repo-toolkit/secret-sync","description":"@repo-toolkit/secret-sync synchronizes explicitly selected local files with 1Password Connect or directly with the official 1Password SDK, preserving exact bytes including binary data and line endings.","source":"@site/docs/packages/secret-sync.md","sourceDirName":"packages","slug":"/packages/secret-sync","permalink":"/docs/packages/secret-sync","draft":false,"unlisted":false,"tags":[],"version":"current","sidebarPosition":8,"frontMatter":{"sidebar_label":"Secret Sync","sidebar_position":8},"sidebar":"packagesSidebar","previous":{"title":"Docker Publish","permalink":"/docs/packages/docker-publish"}}');
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(1325);
// EXTERNAL MODULE: ./node_modules/.pnpm/@mdx-js+react@3.1.1_@types+react@19.2.14_react@19.2.6/node_modules/@mdx-js/react/lib/index.js
var lib = __webpack_require__(1982);
;// ./docs/packages/secret-sync.md


const frontMatter = {
	sidebar_label: 'Secret Sync',
	sidebar_position: 8
};
const contentTitle = '@repo-toolkit/secret-sync';

const assets = {

};



const toc = [{
  "value": "Install",
  "id": "install",
  "level": 2
}, {
  "value": "Configuration",
  "id": "configuration",
  "level": 2
}, {
  "value": "Selection",
  "id": "selection",
  "level": 2
}, {
  "value": "Connect deployment and auth",
  "id": "connect-deployment-and-auth",
  "level": 2
}, {
  "value": "Direct SDK setup (no Connect server)",
  "id": "direct-sdk-setup-no-connect-server",
  "level": 2
}, {
  "value": "Moving a Connect worktree to direct access",
  "id": "moving-a-connect-worktree-to-direct-access",
  "level": 2
}, {
  "value": "Permissions, vault scope, and limits",
  "id": "permissions-vault-scope-and-limits",
  "level": 2
}, {
  "value": "Runtime and platform support",
  "id": "runtime-and-platform-support",
  "level": 2
}, {
  "value": "Limits: proposed tool bounds vs verified ceilings",
  "id": "limits-proposed-tool-bounds-vs-verified-ceilings",
  "level": 2
}, {
  "value": "Identity, state, retention, branches, recovery, visibility",
  "id": "identity-state-retention-branches-recovery-visibility",
  "level": 2
}, {
  "value": "CLI",
  "id": "cli",
  "level": 2
}, {
  "value": "Listing vaults",
  "id": "listing-vaults",
  "level": 2
}, {
  "value": "Viewing file content without pulling",
  "id": "viewing-file-content-without-pulling",
  "level": 2
}, {
  "value": "Fake-server example without a real vault",
  "id": "fake-server-example-without-a-real-vault",
  "level": 2
}, {
  "value": "Fake-SDK example without a real vault",
  "id": "fake-sdk-example-without-a-real-vault",
  "level": 2
}];
function _createMdxContent(props) {
  const _components = {
    code: "code",
    h1: "h1",
    h2: "h2",
    header: "header",
    p: "p",
    pre: "pre",
    ...(0,lib/* useMDXComponents */.R)(),
    ...props.components
  };
  return (0,jsx_runtime.jsxs)(jsx_runtime.Fragment, {
    children: [(0,jsx_runtime.jsx)(_components.header, {
      children: (0,jsx_runtime.jsx)(_components.h1, {
        id: "repo-toolkitsecret-sync",
        children: (0,jsx_runtime.jsx)(_components.code, {
          children: "@repo-toolkit/secret-sync"
        })
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "@repo-toolkit/secret-sync"
      }), " synchronizes explicitly selected local files with 1Password Connect or directly with the official 1Password SDK, preserving exact bytes including binary data and line endings."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "install",
      children: "Install"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "pnpm add -D @repo-toolkit/secret-sync\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "configuration",
      children: "Configuration"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "secret-sync.config.json"
      }), " (JSON, ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".mjs"
      }), ", or ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".cjs"
      }), " via the shared ", (0,jsx_runtime.jsx)(_components.code, {
        children: "loadConfigFile"
      }), " helper). Every command loads ", (0,jsx_runtime.jsx)(_components.code, {
        children: "./secret-sync.config.json"
      }), " from the working directory by default; pass ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--config <path>"
      }), " to use another file (", (0,jsx_runtime.jsx)(_components.code, {
        children: "vault list --provider …"
      }), " is the only command that runs without any config):"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-json",
        children: "{\n  \"schemaVersion\": 1,\n  \"projectId\": \"a64208df-4a95-4516-b8c7-e00621a7820c\",\n  \"root\": \".\",\n  \"remote\": {\n    \"type\": \"onepassword-connect\",\n    \"vaultId\": \"<1password-vault-id>\",\n    \"hostEnv\": \"OP_CONNECT_HOST\",\n    \"tokenEnv\": \"OP_CONNECT_TOKEN\"\n  },\n  \"branch\": \"main\",\n  \"files\": [\".env\", \".env.*\", \"apps/**/.env*\", \"secrets/**/*.{json,pem,key}\"],\n  \"ignore\": [\"**/.env.example\", \"**/node_modules/**\", \"**/dist/**\"],\n  \"limits\": {\n    \"maxFileBytes\": 32768,\n    \"maxFiles\": 100,\n    \"concurrency\": 4\n  }\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Branch names match ", (0,jsx_runtime.jsx)(_components.code, {
        children: "[A-Za-z0-9][A-Za-z0-9._/-]{0,127}"
      }), " with empty, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "."
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".."
      }), " segments rejected. Limits can only lower the hard ceilings (32 KiB per file, 100 files, concurrency 8). Tokens never live in config or plans — only environment variable names."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "selection",
      children: "Selection"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Selection is glob matching via ", (0,jsx_runtime.jsx)(_components.code, {
        children: "picomatch"
      }), " (dotfiles enabled, case-sensitive): ", (0,jsx_runtime.jsx)(_components.code, {
        children: "files"
      }), " is an inclusion union, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ignore"
      }), " always wins, and ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".git/**"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".repo-toolkit-secret-sync/**"
      }), ", plus the active config file are always excluded. Directories matching a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "/**"
      }), "-suffixed ignore (e.g. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "**/node_modules/**"
      }), ") are pruned from traversal and don't count toward the 10,000-record scan bound. When every ", (0,jsx_runtime.jsx)(_components.code, {
        children: "files"
      }), " entry is a literal path with no glob characters, discovery stats those paths directly instead of walking the root. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--file <path>"
      }), " selects an exact path inside the allowed set, is repeatable without comma splitting, and never overrides excludes. Use ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--file=<name>"
      }), " for dash-leading paths (e.g. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--file=-leading-name"
      }), ")."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "connect-deployment-and-auth",
      children: "Connect deployment and auth"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["A deployed 1Password Connect server is required for the Connect backend. The endpoint comes from ", (0,jsx_runtime.jsx)(_components.code, {
        children: "OP_CONNECT_HOST"
      }), " and the token from ", (0,jsx_runtime.jsx)(_components.code, {
        children: "OP_CONNECT_TOKEN"
      }), " by default; config may name alternative environment variables. Tokens never live in config, argv, plans, output, or errors. HTTPS is required except for HTTP loopback. URL credentials, fragments, and redirects are rejected. Provisioning Connect infrastructure is out of scope. Read-only Connect access covers ", (0,jsx_runtime.jsx)(_components.code, {
        children: "status"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "pull"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "log"
      }), "; ", (0,jsx_runtime.jsx)(_components.code, {
        children: "push"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "rollback"
      }), ", branch creation, and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "resolve"
      }), " need write access. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "doctor"
      }), " reports observed read capability only and never claims write access without a write probe."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "direct-sdk-setup-no-connect-server",
      children: "Direct SDK setup (no Connect server)"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Select the direct backend per config with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "remote.type: \"onepassword-sdk\""
      }), ". The backend is never inferred from whichever token happens to be set, and direct operation needs no Connect variables, Docker, the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "op"
      }), " CLI, or a running Connect endpoint. Two explicit auth modes are supported."]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Service-account mode (CI/headless):"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-json",
        children: "{\n  \"remote\": {\n    \"type\": \"onepassword-sdk\",\n    \"vaultId\": \"<1password-vault-id>\",\n    \"auth\": { \"type\": \"service-account\", \"tokenEnv\": \"OP_SERVICE_ACCOUNT_TOKEN\" }\n  }\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-secret-sync init --config secret-sync.config.json --vault <vault-id> \\\n  --provider onepassword-sdk --auth service-account --token-env OP_SERVICE_ACCOUNT_TOKEN\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Desktop mode (local use, approval prompts come from 1Password itself):"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-json",
        children: "{\n  \"remote\": {\n    \"type\": \"onepassword-sdk\",\n    \"vaultId\": \"<1password-vault-id>\",\n    \"auth\": { \"type\": \"desktop\", \"account\": \"<1password-account-id-or-name>\" }\n  }\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-secret-sync init --config secret-sync.config.json --vault <vault-id> \\\n  --provider onepassword-sdk --auth desktop --account <1password-account-id-or-name>\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Prefer a stable account ID where supported; the account selector is passed through to the SDK and only its non-secret value appears in diagnostics. Tokens are read from the environment during execution only and never persisted in config, plans, state, results, errors, or diagnostic JSON. A denied or cancelled desktop prompt is an authentication error with no fallback to another account, token, or Connect. Planning, validation, help, and local-only ", (0,jsx_runtime.jsx)(_components.code, {
        children: "init"
      }), " never initialize or authenticate the SDK; an online dry run may read but never creates items or changes worktree/state. One SDK client is created lazily per command execution and shared by concurrent store calls."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "moving-a-connect-worktree-to-direct-access",
      children: "Moving a Connect worktree to direct access"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["A config-only provider change refuses to reuse existing state: backend, vault, or project changes are identity mismatches. Transition with a fresh worktree and state directory using the same vault and project IDs, then reconcile preexisting local files through the existing unbased-conflict rules. The tool never auto-deletes journals, resets a dirty worktree, or offers an in-place backend-rebind command. Service-account token rotation and switching auth mode for the same vault/project keep baselines; local state is ", (0,jsx_runtime.jsx)(_components.code, {
        children: "0600"
      }), " files under a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "0700"
      }), " directory with no tokens, endpoint credentials, payloads, or sessions."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "permissions-vault-scope-and-limits",
      children: "Permissions, vault scope, and limits"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Service accounts are vault/permission scoped: read-only access covers ", (0,jsx_runtime.jsx)(_components.code, {
        children: "status"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "pull"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "log"
      }), ", while ", (0,jsx_runtime.jsx)(_components.code, {
        children: "push"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "rollback"
      }), ", branch creation, and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "resolve"
      }), " need write access, and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "doctor"
      }), " reports observed read capability only. Service accounts cannot access built-in Personal/Private/Employee vaults. Desktop approval grants temporary access to the authorized account, which is broader than the configured vault filter — the tool still lists only the configured vault. An account lacking the configured vault fails access checks instead of selecting a similarly named vault."]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "The file/record bounds are unchanged across backends: 32 KiB per file, 100 files, 64 KiB serialized record, 10,000 records per scan, 256 KiB detail responses, 30 s timeouts, concurrency default 4 (max 8). Direct reads retry up to three times with bounded backoff; creates are never retried, and a timeout around a create is an uncertain write reconciled by logical ID, not evidence of failure. Service-account quotas differ from Connect: the SDK surfaces rate limiting as an error with no documented quota numbers, and an incomplete listing never implies deletion. Live-vault verification of ceilings, visibility latency, quota numbers, and permission behavior is still required before any storage-compatibility claim."
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "runtime-and-platform-support",
      children: "Runtime and platform support"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Direct mode needs ", (0,jsx_runtime.jsx)(_components.code, {
        children: "@1password/sdk@0.5.0"
      }), " (MIT) with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "@1password/sdk-core@0.5.0"
      }), " (MIT, ~14 MB unpacked wasm). The SDK stays external to the built bundle and ships through the package manager's production dependency closure; a missing wasm asset fails with an explicit runtime-assets error that is never disguised as a credential failure. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "engines"
      }), " requires Node >= 20. The SDK targets Node.js only; desktop IPC is supported on darwin/linux/win32, and other platform combinations are unverified against live accounts. Selecting Connect never initializes the SDK, and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--help"
      }), " plus every Connect workflow run without SDK initialization."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "limits-proposed-tool-bounds-vs-verified-ceilings",
      children: "Limits: proposed tool bounds vs verified ceilings"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Tool bounds (not claimed 1Password limits): 32 KiB per file, 100 files, 64 KiB serialized record, 10,000 records per scan, 16 MiB list responses, 256 KiB detail responses, 30 s timeouts, three bounded GET retries, concurrency default 4 (max 8). Config can lower file and count bounds, never raise them. Synthetic probes round-trip empty, binary, multiline, and 32 KiB payloads with byte equality; live-vault verification of ceilings, visibility latency, and permission behavior is still required before any storage-compatibility claim."
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "identity-state-retention-branches-recovery-visibility",
      children: "Identity, state, retention, branches, recovery, visibility"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Remote identity (endpoint plus vault ID plus project ID) is pinned in ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".repo-toolkit-secret-sync/state.json"
      }), " (0700 dir, 0600 files, generated HMAC key; no bodies, tokens, or diffs). Changing identity requires reinitialization. History is retained in v1; deletion is a tombstone and pruning is deferred. Branches are organizational within one vault, not authorization boundaries; use separate vaults for access separation. Push checks observed heads before and after publication; delayed synchronization can reveal another head later, so success means verification on the configured endpoint, not global durability. An ambiguous blob write is first re-found by logical id, then by byte-identical content, so retrying a push adopts an orphaned blob from an earlier attempt instead of failing forever. Local writes are per-file atomic with journaled resume and same-host locks."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "cli",
      children: "CLI"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-secret-sync init --config secret-sync.config.json --vault <vault-id>\nrepo-toolkit-secret-sync doctor\nrepo-toolkit-secret-sync status --check --json\nrepo-toolkit-secret-sync push --file .env --message \"Rotate credentials\"\nrepo-toolkit-secret-sync pull --dry-run\nrepo-toolkit-secret-sync diff --file .env\nrepo-toolkit-secret-sync log --file .env --limit 20\nrepo-toolkit-secret-sync restore --file .env --revision <blob-id>\nrepo-toolkit-secret-sync rollback --file .env --revision <blob-id> --message \"Revert\"\nrepo-toolkit-secret-sync branch list\nrepo-toolkit-secret-sync branch create --name feature/demo --from main\nrepo-toolkit-secret-sync switch --branch feature/demo\nrepo-toolkit-secret-sync resolve --head <A> --head <B> --take <A>\nrepo-toolkit-secret-sync vault list\nrepo-toolkit-secret-sync show --file .env --revision <blob-id>\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The command is the first non-wrapper token (", (0,jsx_runtime.jsx)(_components.code, {
        children: "branch"
      }), " takes a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "list|create"
      }), " subcommand); leading wrapper ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--"
      }), " tokens are stripped and remaining arguments are strict flags. All commands accept ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--config"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--json"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "-h"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "--help"
      }), ". Mutating commands accept ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--dry-run"
      }), " (reads only: no writes, locks, state, or temp files). JSON output is schema-versioned and discriminated with metadata only. Messages and paths are caller metadata and appear in output; do not put secret values in commit messages. Every failure exits 1."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "listing-vaults",
      children: "Listing vaults"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "vault list"
      }), " prints the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "id"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "title"
      }), " of every vault visible to the credential on either backend, for discovering ", (0,jsx_runtime.jsx)(_components.code, {
        children: "remote.vaultId"
      }), ". It is read-only (no state, lock, or temp writes) and supports ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--json"
      }), ". No config file is needed when the backend is given explicitly:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "OP_SERVICE_ACCOUNT_TOKEN=<sa-token> repo-toolkit-secret-sync vault list --provider onepassword-sdk --auth service-account\nrepo-toolkit-secret-sync vault list --provider onepassword-sdk --auth desktop --account <account-id-or-name>\nOP_CONNECT_HOST=http://127.0.0.1:8080 OP_CONNECT_TOKEN=<token> repo-toolkit-secret-sync vault list --provider onepassword-connect\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Service accounts cannot see Personal/Private/Employee vaults."
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "viewing-file-content-without-pulling",
      children: "Viewing file content without pulling"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "show --file <path>"
      }), " prints one tracked file's verified bytes (length- and SHA-256-checked) to stdout without touching the worktree, state, or baselines. Add ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--revision <blob-id>"
      }), " for a historical version or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--branch <name>"
      }), " to read another branch. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "show"
      }), " prints raw bytes only and does not support ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--json"
      }), " (except with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--copy"
      }), ", which emits metadata without bytes); redirect to a file instead of scrolling secrets, and beware shell history. With ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--interactive"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "show"
      }), " walks file, revision, then branch pickers instead of requiring ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--file"
      }), " up front; cancelling aborts with a non-zero exit and prints nothing. With ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--copy"
      }), ", the bytes go to the system clipboard and stdout gets only a confirmation; clipboard contents linger, so clear them when done."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "fake-server-example-without-a-real-vault",
      children: "Fake-server example without a real vault"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "node examples/fake-server.mjs\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "The example starts a loopback fake Connect server, then runs init, push, status, and pull with exact-byte verification."
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "fake-sdk-example-without-a-real-vault",
      children: "Fake-SDK example without a real vault"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "node examples/fake-sdk.mjs\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The example runs service-account and desktop round trips (push, status, pull) through the real SDK adapter against an in-memory fake SDK client with exact-byte verification. No vault, credentials, desktop software, or network access is required. The config examples above are executed in ", (0,jsx_runtime.jsx)(_components.code, {
        children: "test/examples.test.ts"
      }), " against an in-memory fake store, and the shipped record format is a versioned JSON envelope (Secure Note with a concealed ", (0,jsx_runtime.jsx)(_components.code, {
        children: "payload"
      }), " field; titles and tags carry only the tool marker, project ID, record kind, and opaque ID)."]
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