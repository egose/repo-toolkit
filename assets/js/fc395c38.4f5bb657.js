"use strict";
(globalThis["webpackChunkwebsite"] = globalThis["webpackChunkwebsite"] || []).push([[883],{

/***/ 3137
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  assets: () => (/* binding */ assets),
  contentTitle: () => (/* binding */ contentTitle),
  "default": () => (/* binding */ MDXContent),
  frontMatter: () => (/* binding */ frontMatter),
  metadata: () => (/* reexport */ site_docs_packages_release_tag_md_fc3_namespaceObject),
  toc: () => (/* binding */ toc)
});

;// ./.docusaurus/docusaurus-plugin-content-docs/default/site-docs-packages-release-tag-md-fc3.json
const site_docs_packages_release_tag_md_fc3_namespaceObject = /*#__PURE__*/JSON.parse('{"id":"packages/release-tag","title":"@repo-toolkit/release-tag","description":"@repo-toolkit/release-tag determines the next X.Y.Z release tag from Conventional Commits, verifies a clean checkout of the base branch, runs the release command on a changelog/ branch, and opens a GitHub release pull request. It ports egose/actions/release-tag into one repo-toolkit-release-tag executable with an injectable process runner and fetch transport, so every stage is unit-testable without a git daemon or network.","source":"@site/docs/packages/release-tag.md","sourceDirName":"packages","slug":"/packages/release-tag","permalink":"/docs/packages/release-tag","draft":false,"unlisted":false,"tags":[],"version":"current","sidebarPosition":9,"frontMatter":{"sidebar_label":"Release Tag","sidebar_position":9},"sidebar":"packagesSidebar","previous":{"title":"Secret Sync","permalink":"/docs/packages/secret-sync"}}');
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(1325);
// EXTERNAL MODULE: ./node_modules/.pnpm/@mdx-js+react@3.1.1_@types+react@19.2.14_react@19.2.6/node_modules/@mdx-js/react/lib/index.js
var lib = __webpack_require__(1982);
;// ./docs/packages/release-tag.md


const frontMatter = {
	sidebar_label: 'Release Tag',
	sidebar_position: 9
};
const contentTitle = '@repo-toolkit/release-tag';

const assets = {

};



const toc = [{
  "value": "Install",
  "id": "install",
  "level": 2
}, {
  "value": "Prerequisites",
  "id": "prerequisites",
  "level": 2
}, {
  "value": "Non-interactive git authentication",
  "id": "non-interactive-git-authentication",
  "level": 3
}, {
  "value": "Token permissions",
  "id": "token-permissions",
  "level": 3
}, {
  "value": "What preflight proves (and does not prove)",
  "id": "what-preflight-proves-and-does-not-prove",
  "level": 3
}, {
  "value": "How the three stages fit",
  "id": "how-the-three-stages-fit",
  "level": 2
}, {
  "value": "Versioning rules",
  "id": "versioning-rules",
  "level": 2
}, {
  "value": "Verified source preparation",
  "id": "verified-source-preparation",
  "level": 2
}, {
  "value": "Release-command contract",
  "id": "release-command-contract",
  "level": 2
}, {
  "value": "Process and API bounds",
  "id": "process-and-api-bounds",
  "level": 2
}, {
  "value": "PR template and labels",
  "id": "pr-template-and-labels",
  "level": 2
}, {
  "value": "Auto-merge and branch deletion",
  "id": "auto-merge-and-branch-deletion",
  "level": 2
}, {
  "value": "PR-only recovery",
  "id": "pr-only-recovery",
  "level": 2
}, {
  "value": "Signing with externally prepared keys",
  "id": "signing-with-externally-prepared-keys",
  "level": 2
}, {
  "value": "Configuration precedence and environment",
  "id": "configuration-precedence-and-environment",
  "level": 2
}, {
  "value": "CLI reference",
  "id": "cli-reference",
  "level": 2
}, {
  "value": "Library reference",
  "id": "library-reference",
  "level": 2
}, {
  "value": "Examples",
  "id": "examples",
  "level": 2
}, {
  "value": "Full pipeline from git history",
  "id": "full-pipeline-from-git-history",
  "level": 3
}, {
  "value": "Seed history with an explicit version",
  "id": "seed-history-with-an-explicit-version",
  "level": 3
}, {
  "value": "Automatic run with no changes",
  "id": "automatic-run-with-no-changes",
  "level": 3
}, {
  "value": "Environment setup",
  "id": "environment-setup",
  "level": 3
}, {
  "value": "Run stages individually",
  "id": "run-stages-individually",
  "level": 3
}, {
  "value": "Skip the release command or the PR",
  "id": "skip-the-release-command-or-the-pr",
  "level": 3
}, {
  "value": "Auto-merge the release PR",
  "id": "auto-merge-the-release-pr",
  "level": 3
}, {
  "value": "Squash-only repositories",
  "id": "squash-only-repositories",
  "level": 3
}, {
  "value": "Signed release commits",
  "id": "signed-release-commits",
  "level": 3
}, {
  "value": "Recover after a label, merge, or deletion failure",
  "id": "recover-after-a-label-merge-or-deletion-failure",
  "level": 3
}, {
  "value": "Dry-run preview",
  "id": "dry-run-preview",
  "level": 3
}, {
  "value": "Library per-stage composition",
  "id": "library-per-stage-composition",
  "level": 3
}, {
  "value": "Testing with fake runners (vitest)",
  "id": "testing-with-fake-runners-vitest",
  "level": 3
}, {
  "value": "GitHub Actions workflow",
  "id": "github-actions-workflow",
  "level": 3
}, {
  "value": "Dry-run",
  "id": "dry-run",
  "level": 2
}, {
  "value": "Troubleshooting",
  "id": "troubleshooting",
  "level": 2
}, {
  "value": "Migration",
  "id": "migration",
  "level": 2
}, {
  "value": "Migration from <code>egose/actions/release-tag</code>",
  "id": "migration-from-egoseactionsrelease-tag",
  "level": 3
}, {
  "value": "Review remediation contract changes",
  "id": "review-remediation-contract-changes",
  "level": 3
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
        id: "repo-toolkitrelease-tag",
        children: (0,jsx_runtime.jsx)(_components.code, {
          children: "@repo-toolkit/release-tag"
        })
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "@repo-toolkit/release-tag"
      }), " determines the next ", (0,jsx_runtime.jsx)(_components.code, {
        children: "X.Y.Z"
      }), " release tag from Conventional Commits, verifies a clean checkout of the base branch, runs the release command on a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "changelog/<version>"
      }), " branch, and opens a GitHub release pull request. It ports ", (0,jsx_runtime.jsx)(_components.code, {
        children: "egose/actions/release-tag"
      }), " into one ", (0,jsx_runtime.jsx)(_components.code, {
        children: "repo-toolkit-release-tag"
      }), " executable with an injectable process runner and fetch transport, so every stage is unit-testable without a git daemon or network."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The remediation history behind the current contracts lives in the repository's ", (0,jsx_runtime.jsx)(_components.a, {
        href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md",
        children: "release-tag review notes"
      }), ". Behavior changed intentionally in several places versus the reference action and versus earlier package versions; those deltas are called out below and collected in ", (0,jsx_runtime.jsx)(_components.a, {
        href: "#migration",
        children: "Migration"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "install",
      children: "Install"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "pnpm add -D @repo-toolkit/release-tag\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Requires Node.js 20 or newer and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git"
      }), " on ", (0,jsx_runtime.jsx)(_components.code, {
        children: "PATH"
      }), " for the release stage. The package has no runtime dependencies beyond ", (0,jsx_runtime.jsx)(_components.code, {
        children: "@repo-toolkit/publish-package"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "prerequisites",
      children: "Prerequisites"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Stage 2 pushes and stage 3 API calls need working credentials before the run starts. A fail-fast preflight verifies both automatically after determine and before any mutation; bypass it with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--skip-preflight"
      }), " only for exotic setups."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "non-interactive-git-authentication",
      children: "Non-interactive git authentication"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Every git-over-SSH connection prompts for a passphrase unless an agent holds the key. One stalled prompt mid-run strands a half-pushed ", (0,jsx_runtime.jsx)(_components.code, {
        children: "changelog/*"
      }), " branch, so set this up first:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "eval \"$(ssh-agent -s)\" && ssh-add ~/.ssh/<key>\nssh -T git@github.com\nGIT_SSH_COMMAND=\"ssh -o BatchMode=yes\" git ls-remote origin HEAD\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "All three must succeed with no prompt; the last proves fully non-interactive auth. The agent does not survive reboots or re-logins — persist it via your OS keychain, a systemd unit, or a shell-profile snippet, or re-add the key each session. Alternatives: a passphrase-less deploy key restricted to the repo (convenient, but weaker if the key leaks), or an HTTPS remote with a credential helper holding a PAT (one credential for git and API, at the cost of a token on disk)."
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The preflight probe runs ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git ls-remote origin HEAD"
      }), " with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GIT_TERMINAL_PROMPT=0"
      }), ". Existing ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GIT_SSH_COMMAND"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GIT_SSH"
      }), ", and Git's ", (0,jsx_runtime.jsx)(_components.code, {
        children: "core.sshCommand"
      }), " identities are preserved (including the deploy key configured by ", (0,jsx_runtime.jsx)(_components.code, {
        children: "actions/checkout"
      }), "); the built-in default ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ssh -o BatchMode=yes"
      }), " is supplied only when no SSH override is configured. Empty SSH environment overrides are treated as unset. Every later package-owned Git and release child also receives ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GIT_TERMINAL_PROMPT=0"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "token-permissions",
      children: "Token permissions"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The token needs these repository permissions (job ", (0,jsx_runtime.jsx)(_components.code, {
        children: "permissions"
      }), " for ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_TOKEN"
      }), ", repository access for a fine-grained PAT):"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "Operation"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Minimum permission"
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsxs)(_components.td, {
            children: ["Push the ", (0,jsx_runtime.jsx)(_components.code, {
              children: "changelog/*"
            }), " branch, merge the PR, delete the ref"]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Contents: read and write"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "Create the PR"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Pull requests: read and write"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsxs)(_components.td, {
            children: ["Add the ", (0,jsx_runtime.jsx)(_components.code, {
              children: "changelog"
            }), ", ", (0,jsx_runtime.jsx)(_components.code, {
              children: "release-candidate"
            }), ", ", (0,jsx_runtime.jsx)(_components.code, {
              children: "<tag>"
            }), " labels"]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Issues: read and write"
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The same set covers runs with and without ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--auto-merge-pr"
      }), ", since merge and ref deletion fall under Contents. A classic PAT needs the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "repo"
      }), " scope (", (0,jsx_runtime.jsx)(_components.code, {
        children: "public_repo"
      }), " for public-only repos). GitHub reports insufficient permission as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "404"
      }), ", not ", (0,jsx_runtime.jsx)(_components.code, {
        children: "403"
      }), ", so a 404 from a labels or repo endpoint can mean the token lacks access. Verify a token file before relying on it:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "GH_TOKEN=$(cat ./token.txt) gh api repos/octocat/hello --jq .permissions\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "push"
      }), " must be ", (0,jsx_runtime.jsx)(_components.code, {
        children: "true"
      }), ". The value never lands in shell history with this form."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "what-preflight-proves-and-does-not-prove",
      children: "What preflight proves (and does not prove)"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Preflight reads the repository metadata and accepts ", (0,jsx_runtime.jsx)(_components.code, {
        children: "permissions.push: true"
      }), ". When that user-permission flag is absent or false, it confirms an App installation token with a read-only ", (0,jsx_runtime.jsx)(_components.code, {
        children: "HEAD /installation/repositories?per_page=1"
      }), " probe. This supports the built-in Actions ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_TOKEN"
      }), "; its endpoint-specific write permissions come from the workflow's ", (0,jsx_runtime.jsx)(_components.code, {
        children: "permissions"
      }), " block."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Read access plus installation identity does ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "not"
      }), " prove write permission on every endpoint the run will touch, and it does not eliminate later authentication failures: GitHub enforces Contents, Pull requests, and Issues permissions when the PR is created, labeled, merged, or deleted, and any of those steps can still fail with a permission-shaped 404. Treat preflight as a fail-fast probe that catches missing credentials before mutation, not as a guarantee that all later writes will succeed. See ", (0,jsx_runtime.jsx)(_components.a, {
        href: "#troubleshooting",
        children: "Troubleshooting"
      }), " for the resulting errors."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "how-the-three-stages-fit",
      children: "How the three stages fit"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "runReleaseTag"
      }), " resolves a validated plan without I/O, validates the stage selection (including for dry-run), then runs ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determine"
      }), " -> ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release"
      }), " -> ", (0,jsx_runtime.jsx)(_components.code, {
        children: "pr"
      }), " in order. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "only"
      }), " filters which stages run; unselected stages yield ", (0,jsx_runtime.jsx)(_components.code, {
        children: "null"
      }), " results. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "skipRelease"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "skipPr"
      }), " still invoke their stage, which returns a skipped result, so ", (0,jsx_runtime.jsx)(_components.code, {
        children: "null"
      }), " means not-selected while a skipped result means selected-but-skipped."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["After determine and before any mutation, a preflight verifies non-interactive git auth (when ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release"
      }), " is selected) and token validity plus push permission (when ", (0,jsx_runtime.jsx)(_components.code, {
        children: "pr"
      }), " is selected, not skipped, and a token is available); a missing token still yields the graceful stage-3 skip rather than a preflight error. A determination with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "noChanges: true"
      }), " bypasses preflight and every later stage entirely and returns ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release: null"
      }), " with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "pullRequest: null"
      }), ". Any throw propagates with secrets redacted and stops later stages. Token bytes never appear in plans, results, JSON output, or errors."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "only: ['pr']"
      }), " with explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tag"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "baseBranch"
      }), " is the read-only ", (0,jsx_runtime.jsx)(_components.a, {
        href: "#pr-only-recovery",
        children: "PR-only recovery"
      }), " composition, not a normal prefix: it revalidates the existing release identity from local Git state and runs the idempotent PR stage without configuring Git, changing refs, or running the release command. Every other non-prefix subset (", (0,jsx_runtime.jsx)(_components.code, {
        children: "release"
      }), " without ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determine"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "pr"
      }), " without both) throws before I/O, including in dry-run."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "versioning-rules",
      children: "Versioning rules"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["A manual ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tag"
      }), " strips at most one leading ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v"
      }), ", then requires strict numeric ", (0,jsx_runtime.jsx)(_components.code, {
        children: "X.Y.Z"
      }), " with no leading zeros and no prerelease or build metadata. Each component must be a safe integer (", (0,jsx_runtime.jsx)(_components.code, {
        children: "0"
      }), " through ", (0,jsx_runtime.jsx)(_components.code, {
        children: "9007199254740991"
      }), "). ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v1.2.3"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "1.2.3"
      }), " both resolve to version ", (0,jsx_runtime.jsx)(_components.code, {
        children: "1.2.3"
      }), " and tag ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v1.2.3"
      }), "; ", (0,jsx_runtime.jsx)(_components.code, {
        children: "vv1.2.3"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "1.2"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "1.2.3.4"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "1.2.3-beta"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "1.2.3+build"
      }), " all throw. This is an intentional fix versus the reference shell ", (0,jsx_runtime.jsx)(_components.code, {
        children: "${input_tag//v}"
      }), ", which strips every ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v"
      }), " character. Manual tags are always explicit release requests with zero Git reads during determination; numeric bump outputs are validated too, so an increment past the safe-integer limit fails inside determination before authentication or mutation."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Without a manual tag, stage 1 runs ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git describe --tags --abbrev=0"
      }), " for the latest tag and requires strict stable ", (0,jsx_runtime.jsx)(_components.code, {
        children: "vX.Y.Z"
      }), ". A missing tag gives guidance to seed history with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--tag"
      }), "; nonconforming latest tags are rejected rather than reinterpreted or skipped. It then reads NUL-delimited commit-ID/raw-message records from ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git log <lastTag>..HEAD"
      }), " and classifies each commit independently:"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Any conventional type with a header ", (0,jsx_runtime.jsx)(_components.code, {
          children: "!"
        }), " (for example ", (0,jsx_runtime.jsx)(_components.code, {
          children: "refactor!: ..."
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "chore(deps)!: ..."
        }), "), or an uppercase column-zero ", (0,jsx_runtime.jsx)(_components.code, {
          children: "BREAKING CHANGE: <description>"
        }), " / ", (0,jsx_runtime.jsx)(_components.code, {
          children: "BREAKING-CHANGE: <description>"
        }), " footer line in the body, gives ", (0,jsx_runtime.jsx)(_components.strong, {
          children: "major"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Otherwise a scoped or unscoped ", (0,jsx_runtime.jsx)(_components.code, {
          children: "feat"
        }), " header (for example ", (0,jsx_runtime.jsx)(_components.code, {
          children: "feat: ..."
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "feat(api): ..."
        }), ") gives ", (0,jsx_runtime.jsx)(_components.strong, {
          children: "minor"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Otherwise the commit gives ", (0,jsx_runtime.jsx)(_components.strong, {
          children: "patch"
        }), "."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Headers are only the first raw line of each message; type matching is case-insensitive with no type allowlist, scopes must be nonempty, and headers require a space or tab after the colon plus a nonempty description. Major takes precedence over minor and patch across all records. A breaking footer can mark a commit whose subject is not conventional, but footer-like text in a subject and inline or indented ", (0,jsx_runtime.jsx)(_components.code, {
        children: "BREAKING CHANGE:"
      }), " examples do not qualify. Body ", (0,jsx_runtime.jsx)(_components.code, {
        children: "feat:"
      }), " examples, incidental ", (0,jsx_runtime.jsx)(_components.code, {
        children: "!:"
      }), " punctuation such as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "fix: handle a!:b"
      }), ", and scoped text like ", (0,jsx_runtime.jsx)(_components.code, {
        children: "feat(scope!:example): add support"
      }), " never trigger a larger bump. An empty-message commit still counts as a commit. These boundaries intentionally correct the old shell behavior of scanning concatenated commit bodies with whole-output regexes; see the ", (0,jsx_runtime.jsx)(_components.a, {
        href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-06-conventional-commit-boundaries-and-no-change-releases",
        children: "version-policy migration notes"
      }), "."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["When the range contains zero commits, the default result is the current version and last tag with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "bump: null"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "noChanges: true"
      }), "; orchestration then performs only the two determination reads and skips preflight, base/ref checks, token-file resolution, release, and PR work, so an unchanged, dirty, or detached checkout returns successfully. Library option ", (0,jsx_runtime.jsx)(_components.code, {
        children: "allowEmptyRelease: true"
      }), " (CLI ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--allow-empty-release"
      }), ") opts back into the old empty-range patch increment; it does not weaken any later validation. Consumers must use ", (0,jsx_runtime.jsx)(_components.code, {
        children: "manual"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "noChanges"
      }), " to interpret ", (0,jsx_runtime.jsx)(_components.code, {
        children: "bump: null"
      }), ":"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "Determination"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Version/tag"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "bump"
            })
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "manual"
            })
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "noChanges"
            })
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsxs)(_components.td, {
            children: ["Manual ", (0,jsx_runtime.jsx)(_components.code, {
              children: "tag"
            })]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Normalized requested version"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "null"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "true"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "Automatic, commits present"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Classified next version"
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "major"
            }), ", ", (0,jsx_runtime.jsx)(_components.code, {
              children: "minor"
            }), ", or ", (0,jsx_runtime.jsx)(_components.code, {
              children: "patch"
            })]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: "Automatic, zero commits, default"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Current version and last tag"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "null"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "true"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsxs)(_components.td, {
            children: ["Automatic, zero commits, ", (0,jsx_runtime.jsx)(_components.code, {
              children: "allowEmptyRelease: true"
            })]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Next patch version"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "patch"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "verified-source-preparation",
      children: "Verified source preparation"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The release branch defaults to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "changelog/<version>"
      }), " where ", (0,jsx_runtime.jsx)(_components.code, {
        children: "<version>"
      }), " is the bare version without ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v"
      }), ". Base and release branches must be valid short Git branch names: leading options, full ", (0,jsx_runtime.jsx)(_components.code, {
        children: "refs/*"
      }), " aliases, refspecs, traversal/dot components, ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".lock"
      }), " components, whitespace/control characters, and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "HEAD"
      }), " are rejected, while ordinary nested and Unicode names remain valid. Base and release branches must differ. Environment values are validated exactly as supplied and are no longer trimmed."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The base branch resolves from explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "baseBranch"
      }), " > non-empty ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_REF_NAME"
      }), " > ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git symbolic-ref --short HEAD"
      }), ". Empty values, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "HEAD"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "refs/tags/*"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "vX.Y.Z"
      }), " tag shapes throw ", (0,jsx_runtime.jsx)(_components.code, {
        children: "This workflow must be run on a branch, not a tag."
      }), " with checkout guidance. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_REF_TYPE=tag"
      }), " or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_REF=refs/tags/*"
      }), " prevents environment base inference, including for non-version tags such as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "latest"
      }), ". Detached HEAD, including spawn failures, throws the same guard. Branch names starting with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v"
      }), " that are not strict tags (for example ", (0,jsx_runtime.jsx)(_components.code, {
        children: "version-next"
      }), ") are accepted."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Before configuring Git or preparing a branch, stage 2 requires the selected ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "local"
      }), " base branch to be checked out, HEAD to match its inspected commit, and a clean tracked/untracked worktree; an explicit or environment base never authorizes releasing another branch at the same commit, a detached HEAD, or a tag checkout. Branch creation uses the verified source commit explicitly and never switches to or resets the base."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Existing local or remote release branches are refused by default. With ", (0,jsx_runtime.jsx)(_components.code, {
        children: "resetReleaseBranch: true"
      }), " (CLI ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--reset-release-branch"
      }), "), stage 2 resets only the release branch from the verified source commit, retaining its local reflog and updating the existing remote ref with an explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--force-with-lease=<full-ref>:<observed-object-id>"
      }), "; new remote branches use an empty expected ID to require remote absence. There are no branch deletions or unconditional force pushes, and the base ref is never reset. Local symbolic branch refs (including dangling aliases omitted by ordinary ref listings) and remote-advertised symbolic aliases are refused before configuration or reset, because Git can otherwise follow a symbolic release ref and move the base."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["New releases are refused when the target tag already exists locally or on origin; release tags are immutable and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "resetReleaseBranch"
      }), " never overrides that. Choose a new version rather than deleting or overwriting a tag. Explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "skipRelease"
      }), " still prepares/pushes the branch and reads existing tag metadata while bypassing command availability, duplicate-tag refusal, and executed-release postconditions."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Preparation is not transactional: a failed lease or later step can leave a local prepared branch (including an explicitly authorized reset) and an already-pushed upstream branch. Inspect that state before retrying, serialize release jobs, and never treat tag deletion as a recovery action. See the ", (0,jsx_runtime.jsx)(_components.a, {
        href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-02-verified-source-preparation-and-release-postconditions",
        children: "lifecycle notes"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "release-command-contract",
      children: "Release-command contract"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The default command is ", (0,jsx_runtime.jsx)(_components.code, {
        children: "./node_modules/.bin/release-it"
      }), ". Availability is checked ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "before"
      }), " any branch mutation: a path containing ", (0,jsx_runtime.jsx)(_components.code, {
        children: "/"
      }), " must resolve to an executable regular file relative to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "cwd"
      }), ", and a bare name must pass a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "<cmd> --version"
      }), " probe capped at ", (0,jsx_runtime.jsx)(_components.code, {
        children: "min(timeoutMs, 10s)"
      }), ". Missing, non-executable, and failed-probe commands fail with installation/configuration guidance instead of pushing a branch and reporting success. Deliberate ", (0,jsx_runtime.jsx)(_components.code, {
        children: "skipRelease"
      }), " remains the supported way to prepare a branch without running a command."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The command runs as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "<releaseCommand> <version> --ci [...releaseArgs]"
      }), ", with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--git.commitArgs=--gpg-sign"
      }), " appended when ", (0,jsx_runtime.jsx)(_components.code, {
        children: "signCommit"
      }), " is true. Extra ", (0,jsx_runtime.jsx)(_components.code, {
        children: "releaseArgs"
      }), " (CLI ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--release-arg"
      }), ", repeatable and raw) are appended after ", (0,jsx_runtime.jsx)(_components.code, {
        children: "<version> --ci"
      }), ". Release execution uses captured, bounded output like every other package-owned child, so a noisy executable cannot corrupt JSON stdout; failures include bounded diagnostics. The release command is the executable's own tag publisher: package-owned branch pushes use explicit refspecs and disable implicit tag following."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["A zero exit alone is insufficient. A successful executable must leave the expected release branch checked out, a clean worktree, and the target ", (0,jsx_runtime.jsx)(_components.code, {
        children: "<tagVersion>"
      }), " resolving to HEAD; missing/mismatched tags, branch switches, detached HEAD, or pending changes stop the package's final push and all downstream PR work. Successful executed releases record the verified full commit ID in ", (0,jsx_runtime.jsx)(_components.code, {
        children: "releasedHead"
      }), ", and the final branch publication pins that commit with a lease on the prepared source (also accepting a branch already published at the same head by the executable)."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["A directly invoked stage excluded by ", (0,jsx_runtime.jsx)(_components.code, {
        children: "only"
      }), ", like its dry-run path, performs zero process/file/network operations and requires an explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "baseBranch"
      }), " or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_REF_NAME"
      }), " because no Git fallback is attempted. Dry-run returns ", (0,jsx_runtime.jsx)(_components.code, {
        children: "releaseRan: false"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "skippedReason: 'dry-run'"
      }), ", and an empty tag message."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "process-and-api-bounds",
      children: "Process and API bounds"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Every package-owned Git, availability-probe, and release process uses asynchronous capture with a ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "combined raw stdout/stderr limit"
      }), " (", (0,jsx_runtime.jsx)(_components.code, {
        children: "maxOutputBytes"
      }), ", default 1 MiB, positive safe integer) applied while streaming, and a ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "per-command deadline"
      }), " (", (0,jsx_runtime.jsx)(_components.code, {
        children: "timeoutMs"
      }), ", default 60,000 ms, integer range ", (0,jsx_runtime.jsx)(_components.code, {
        children: "1..2147483647"
      }), "). On POSIX, timeout/overflow terminates the process group, escalating from SIGTERM to SIGKILL after 250 ms, with a further 1 s cleanup allowance; process groups that escape, OS-uninterruptible tasks, and non-POSIX process-tree cancellation are outside the guarantee. CLI flags are ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--timeout-ms"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--max-output-bytes"
      }), " (decimal digits only: no blanks, signs, leading zeros, fractions, exponents, or hexadecimal)."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["GitHub response bodies stream with a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "min(maxOutputBytes, 1MiB)"
      }), " cap and one deadline covering fetch ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "and"
      }), " body reads; overflow/failure cancels the reader and aborts the request, and authenticated redirects are disabled. API bases use HTTPS except numeric loopback HTTP (", (0,jsx_runtime.jsx)(_components.code, {
        children: "127.0.0.0/8"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "::1"
      }), ") or literal ", (0,jsx_runtime.jsx)(_components.code, {
        children: "localhost"
      }), ", reject userinfo/query/fragment routing, and preserve GHES prefixes such as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "/api/v3"
      }), ". Token files must resolve to regular files of at most ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "65,536 raw bytes"
      }), "; empty, unreadable, oversized, nonregular, or invalid-header files fail without fallback, and tokens must be single ASCII bearer tokens. Credentials resolve lazily once per orchestration and stay pinned through preflight, release, and PR work even if the token file or environment rotates; plans and skipped/dry-run credential paths never open token files. See the ", (0,jsx_runtime.jsx)(_components.a, {
        href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-03-bounded-captured-process-execution",
        children: "process"
      }), " and ", (0,jsx_runtime.jsx)(_components.a, {
        href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-04-private-credentials-and-bounded-github-transport",
        children: "credential/HTTP"
      }), " contract notes."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Custom transports own their actual execution behavior. Injected ", (0,jsx_runtime.jsx)(_components.code, {
        children: "CapturingProcessRunner"
      }), " implementations must handle ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "every"
      }), " invocation through ", (0,jsx_runtime.jsx)(_components.code, {
        children: "capture"
      }), ", including the release command (", (0,jsx_runtime.jsx)(_components.code, {
        children: "run"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "runShell"
      }), " are unused), and must implement their own streaming bounds, environment merging, deadlines, termination, and stdout isolation; the boundary only validates completed shapes, combined UTF-8 bytes, and elapsed time afterwards. Custom fetch implementations must return standard ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Response"
      }), " byte streams, honor the redirect policy and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "AbortSignal"
      }), ", and own socket/producer cleanup; the boundary cannot undo credential forwarding or side effects inside an injected transport, preempt blocking JavaScript, or bound memory it allocated before delivering a chunk."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "pr-template-and-labels",
      children: "PR template and labels"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Stage 3 skips without network in this order: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "skipPr"
      }), " (", (0,jsx_runtime.jsx)(_components.code, {
        children: "skipped via skipPr"
      }), "), ", (0,jsx_runtime.jsx)(_components.code, {
        children: "only"
      }), " excludes ", (0,jsx_runtime.jsx)(_components.code, {
        children: "pr"
      }), " (", (0,jsx_runtime.jsx)(_components.code, {
        children: "stage not selected"
      }), "), ", (0,jsx_runtime.jsx)(_components.code, {
        children: "dryRun"
      }), " (", (0,jsx_runtime.jsx)(_components.code, {
        children: "dry-run"
      }), "), then missing token (", (0,jsx_runtime.jsx)(_components.code, {
        children: "github token not available"
      }), "). Dry-run is checked before token availability, so dry-run never reads token files."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Token resolution order is explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "githubToken"
      }), " > trimmed ", (0,jsx_runtime.jsx)(_components.code, {
        children: "githubTokenFile"
      }), " contents > ", (0,jsx_runtime.jsx)(_components.code, {
        children: "process.env[githubTokenEnv]"
      }), ". The file is read relative to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "cwd"
      }), "; empty files throw without falling back to env, and unreadable files throw without network calls. An explicitly supplied empty token fails; an empty environment variable means no token. The token travels only in the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Authorization: Bearer"
      }), " header, and known explicit/environment/file credentials plus the active file token are redacted from diagnostics, output snapshots, and PR descriptions."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The repository resolves from explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "githubRepository"
      }), " > ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_REPOSITORY"
      }), ". Both must use ", (0,jsx_runtime.jsx)(_components.code, {
        children: "owner/repo"
      }), " with ASCII letters, digits, dots, underscores, or hyphens per component; dot segments, routing delimiters, and control characters are rejected. Git remotes are not parsed."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "formatPullRequestBody(tagMessage)"
      }), " renders the exact template:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-text",
        children: "### Release Candidate Details\n\n<tagMessage>\n\n---\n\n> This PR was automatically generated.\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Labels are always ", (0,jsx_runtime.jsx)(_components.code, {
        children: "['changelog', 'release-candidate', determined.tagVersion]"
      }), ". Appended OpenPGP, SSH, and X.509 signature blocks are removed from tag messages and generated PR bodies, preserving the annotation text."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Stage 3 discovers PRs with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GET /repos/{owner}/{repo}/pulls?state=all&head={owner}:{releaseBranch}&base={baseBranch}&per_page=2&page=1"
      }), ", requesting two records so ambiguity fails without scanning arbitrary pages; it never follows response-provided pagination URLs. It creates only when absent, otherwise validates a detail read, updates an open PR's title/body without retargeting its base, and reapplies labels on every successful attempt. Cross-repository/fork heads, mismatched identities, and multiple matches fail; closed-unmerged matches require inspection and reopening or a new release identity. Create status 409/422 permits one exact relookup for a concurrent creator, with no generic mutation retries. A complete conflict/merge/cleanup execution makes at most ten HTTP requests. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "PullRequestResult.reused"
      }), " is ", (0,jsx_runtime.jsx)(_components.code, {
        children: "true"
      }), " for a discovered or concurrently created PR and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "false"
      }), " for an initial creation or skip. Errors after a known PR include its safe number/URL and the failed stage, with guidance to resume the PR stage with the existing verified metadata."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["REST calls use ", (0,jsx_runtime.jsx)(_components.code, {
        children: "fetch"
      }), " against the validated ", (0,jsx_runtime.jsx)(_components.code, {
        children: "githubApiUrl"
      }), " with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Accept: application/vnd.github+json"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "X-GitHub-Api-Version: 2022-11-28"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "User-Agent: repo-toolkit-release-tag"
      }), ", and JSON content type. Failures throw with the redacted status and bounded diagnostics. There are no automatic retries beyond the single create-conflict relookup."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "auto-merge-and-branch-deletion",
      children: "Auto-merge and branch deletion"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "mergeMethod?: 'merge' | 'squash' | 'rebase'"
      }), " (CLI ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--merge-method"
      }), ", default ", (0,jsx_runtime.jsx)(_components.code, {
        children: "merge"
      }), ") selects the immediate REST merge method. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "autoMergePr"
      }), " performs an ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "immediate"
      }), " merge, not queued auto-merge, approval automation, or a merge queue; branch protection, required reviews/checks, and unsupported methods can still reject it and are reported as actionable errors."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Before a requested merge, a fresh detail read must retain the selected PR number, repository IDs, base/head refs, and head SHA. Every observed PR head is compared against ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release.releasedHead"
      }), " when present, and the merge request pins ", (0,jsx_runtime.jsx)(_components.code, {
        children: "sha"
      }), " to the validated head so GitHub's SHA precondition guards a changed head. Only a successful response with literal ", (0,jsx_runtime.jsx)(_components.code, {
        children: "merged === true"
      }), " confirms a requested merge; false, missing, or malformed confirmations never trigger cleanup. An exact already-merged PR returns ", (0,jsx_runtime.jsx)(_components.code, {
        children: "merged: true"
      }), " through detail data without another merge, so cleanup can resume after a lost merge response."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["With both ", (0,jsx_runtime.jsx)(_components.code, {
        children: "autoMergePr"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "deleteMergedBranch"
      }), ", cleanup reads the singular ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GET /git/ref/heads/{releaseBranch}"
      }), ", checks the exact full release ref (never the base) and the merged head SHA, then deletes it; DELETE must return 204. An already-absent ref (404) counts as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "branchDeleted: true"
      }), ", covering GitHub-owned auto-deletion. When ", (0,jsx_runtime.jsx)(_components.code, {
        children: "autoMergePr"
      }), " is false, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "deleteMergedBranch"
      }), " is ignored and the branch is never deleted."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.strong, {
        children: "REST ref deletion is not an atomic compare-and-delete:"
      }), " GitHub's DELETE-ref endpoint provides no SHA lease, so a concurrent writer can change or recreate the ref between the GET check and DELETE, and that new ref can still be deleted. A ref 404 also cannot independently distinguish absence from a simultaneous access-policy change. Serialize release jobs and avoid concurrent ref writers; these checks cannot provide a distributed lock. See the ", (0,jsx_runtime.jsx)(_components.a, {
        href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-05-recoverable-pr-lifecycle-and-verified-merges",
        children: "PR lifecycle notes"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "pr-only-recovery",
      children: "PR-only recovery"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "--only pr --tag X.Y.Z --base-branch main"
      }), " (or library ", (0,jsx_runtime.jsx)(_components.code, {
        children: "only: ['pr']"
      }), " with explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tag"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "baseBranch"
      }), ") recovers the PR stage from the existing local release identity without rerunning the release command or touching tags. It validates inputs without I/O, reads the pinned local target tag object, resolves its commit, strips signatures from the annotation (or lightweight-tag commit message), and checks the local and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "origin"
      }), " release refs. Remote-only branches work from a fresh checkout without a local base, and dirty or detached checkouts are preserved. An absent ", (0,jsx_runtime.jsx)(_components.code, {
        children: "origin"
      }), " branch is accepted only with a verified local tag head and the exact already-merged PR at that commit. Mismatches, missing tags, symbolic aliases, and non-commit tags fail before any write API."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Recovery never runs Git ", (0,jsx_runtime.jsx)(_components.code, {
        children: "config"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "checkout"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "reset"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "push"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "fetch"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "branch"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tag"
      }), ", or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "update-ref"
      }), ", never creates refs, and never runs the release command, regardless of ", (0,jsx_runtime.jsx)(_components.code, {
        children: "resetReleaseBranch"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "signCommit"
      }), ", or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "allowEmptyRelease"
      }), ". It does not fetch or reconstruct refs. Skip/missing-token recovery paths perform zero Git, token-file, and network work. The orchestration result reports ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determined: null"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release: null"
      }), " for the unselected stages with the idempotent PR result; text output names the recovery mode. See the ", (0,jsx_runtime.jsx)(_components.a, {
        href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-07-pr-only-recovery-and-thin-cli",
        children: "recovery notes"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Typical recovery after a label, merge, or deletion failure:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --only pr --tag 1.2.3 --base-branch main --auto-merge-pr --delete-merged-branch\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "This rediscovers the exact matching PR, reapplies labels, retries the merge with SHA pinning, and resumes ref cleanup — no release rerun, no tag deletion, no new release identity."
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "signing-with-externally-prepared-keys",
      children: "Signing with externally prepared keys"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "signCommit"
      }), " only runs ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git config commit.gpgsign true"
      }), " and passes ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--gpg-sign"
      }), " to the release command. It never imports keys, never sets ", (0,jsx_runtime.jsx)(_components.code, {
        children: "user.signingkey"
      }), ", and never writes outside ", (0,jsx_runtime.jsx)(_components.code, {
        children: "cwd"
      }), " or into ", (0,jsx_runtime.jsx)(_components.code, {
        children: "HOME/.gnupg"
      }), ". The runner must already hold a usable secret key: import it in the surrounding workflow into a temporary ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GNUPGHOME"
      }), " with owner-only permissions, point Git at a signing wrapper, and remove the keyring when the step exits. The repository's own dispatch workflow follows exactly this pattern; see the ", (0,jsx_runtime.jsx)(_components.a, {
        href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-dispatch.md",
        children: "release-tag dispatch notes"
      }), ". For a GitHub ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Verified"
      }), " badge, upload the public key to the account matching ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--git-user-email"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "configuration-precedence-and-environment",
      children: "Configuration precedence and environment"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Each option resolves independently as CLI flag > explicit option > environment > built-in default. Only ", (0,jsx_runtime.jsx)(_components.code, {
        children: "githubApiUrl"
      }), " reads an env fallback (", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_API_URL"
      }), "); ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_TOKEN"
      }), " (or the custom ", (0,jsx_runtime.jsx)(_components.code, {
        children: "githubTokenEnv"
      }), "), ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_REPOSITORY"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_REF_NAME"
      }), " are read by the plan and stages at runtime, not by flag mapping."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "CLI flag"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Library option"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Env fallback"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Default"
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--tag"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "tag"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none (derive from git)"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--cwd"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "cwd"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "process.cwd()"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--base-branch"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "baseBranch"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "GITHUB_REF_NAME"
            }), ", then git"]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none (resolved at runtime)"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--release-branch"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "releaseBranch"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "changelog/<version>"
            }), " once known"]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--git-executable"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "gitExecutable"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "git"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "--release-command"
            }), ", ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--release-it-path"
            })]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "releaseCommand"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "./node_modules/.bin/release-it"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--release-arg"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "releaseArgs"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none (empty list)"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--timeout-ms"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "timeoutMs"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "60000"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--max-output-bytes"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "maxOutputBytes"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "1048576"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--git-user-name"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "gitUserName"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "github-actions[bot]"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--git-user-email"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "gitUserEmail"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "github-actions[bot]@users.noreply.github.com"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--sign-commit"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "signCommit"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--github-token"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "githubToken"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none (prefer file)"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--github-token-file"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "githubTokenFile"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--github-token-env"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "githubTokenEnv"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "GITHUB_TOKEN"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--github-repository"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "githubRepository"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "GITHUB_REPOSITORY"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--github-api-url"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "githubApiUrl"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "GITHUB_API_URL"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "https://api.github.com"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--auto-merge-pr"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "autoMergePr"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--merge-method"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "mergeMethod"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "merge"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--delete-merged-branch"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "deleteMergedBranch"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--skip-release"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "skipRelease"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--reset-release-branch"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "resetReleaseBranch"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--allow-empty-release"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "allowEmptyRelease"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--skip-pr"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "skipPr"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--skip-preflight"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "skipPreflight"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--only"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "only"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "all three stages"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--dry-run"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "dryRun"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--json"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none (output only)"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "none"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "human-readable text"
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "--release-it-path"
      }), " is an alias for ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--release-command"
      }), " for action parity; when both appear, the last writer wins. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--sign-commit"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--reset-release-branch"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--allow-empty-release"
      }), " are negatable (", (0,jsx_runtime.jsx)(_components.code, {
        children: "--no-*"
      }), "). ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--release-arg"
      }), " is repeatable and raw: commas are preserved and dash-leading values require the equals form (", (0,jsx_runtime.jsx)(_components.code, {
        children: "--release-arg=--flag=value"
      }), "). ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--only"
      }), " is repeatable and comma-split. Unknown args throw in strict mode. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "-h"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--help"
      }), " print help and exit 0."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Prefer ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--github-token-file"
      }), " over ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--github-token"
      }), ". The CLI warns on stderr when the inline flag is used. The plan records only ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tokenSource"
      }), " (", (0,jsx_runtime.jsx)(_components.code, {
        children: "explicit"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "file"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "env"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "none"
      }), ") and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tokenAvailable"
      }), ". Known explicit/environment credentials and the active file token are redacted from diagnostics, output snapshots, and PR descriptions; raw error causes and caller transport objects are excluded. Parse failures also redact every ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--github-token"
      }), " value (space and equals forms, including overridden repeats) and the referenced custom-env values."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "cli-reference",
      children: "CLI reference"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --tag 1.2.3 --base-branch main\nrepo-toolkit-release-tag --only determine\nrepo-toolkit-release-tag --only pr --tag 1.2.3 --base-branch main --auto-merge-pr --merge-method squash --delete-merged-branch\nrepo-toolkit-release-tag --allow-empty-release --release-arg=--verbose --timeout-ms 120000\nrepo-toolkit-release-tag --skip-release --skip-pr --dry-run\nrepo-toolkit-release-tag --dry-run --json\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "src/cli.ts"
      }), " is a thin entrypoint that only parses, executes, formats, and sets ", (0,jsx_runtime.jsx)(_components.code, {
        children: "process.exitCode"
      }), "; import-safe ", (0,jsx_runtime.jsx)(_components.code, {
        children: "src/cli-options.ts"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "src/format.ts"
      }), " own flags/secrets and help/JSON/text rendering, so tests import those helpers without executing CLI or Git/network code."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Human output prints one line per stage with versions, branches, PR numbers and URLs, and skip reasons; unselected stages print ", (0,jsx_runtime.jsx)(_components.code, {
        children: "not selected"
      }), ", no-change downstream stages print ", (0,jsx_runtime.jsx)(_components.code, {
        children: "skipped (no changes)"
      }), ", and PR-only recovery names its read-only mode. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--json"
      }), " prints exactly one schema-1 object (", (0,jsx_runtime.jsx)(_components.code, {
        children: "schemaVersion"
      }), ", secret-free ", (0,jsx_runtime.jsx)(_components.code, {
        children: "plan"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determined"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "pullRequest"
      }), ") even when children are noisy; dry-run JSON adds ", (0,jsx_runtime.jsx)(_components.code, {
        children: "dryRun: true"
      }), ". Schema 1 is retained because the remediation only added optional/backward-compatible fields (", (0,jsx_runtime.jsx)(_components.code, {
        children: "releasedHead"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "reused"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "noChanges"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "allowEmptyRelease"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "resetReleaseBranch"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "mergeMethod"
      }), "); no established field changed shape. Errors print the redacted message to stderr and set ", (0,jsx_runtime.jsx)(_components.code, {
        children: "process.exitCode = 1"
      }), " without calling ", (0,jsx_runtime.jsx)(_components.code, {
        children: "process.exit"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Dry-run text prints the sorted resolved plan summary, for example:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-text",
        children: "dry-run: no processes spawned and no network calls made\nallowEmptyRelease: false\nautoMergePr: false\nbaseBranch: main\n...\nreleaseBranch: changelog/1.2.3\n...\ntokenAvailable: false\ntokenSource: none\ndetermined: null (dry-run skips even stage-1 git reads)\nrelease: null\npullRequest: null\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["A ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--dry-run --json"
      }), " plan carries the same fields in machine-readable form:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-json",
        children: "{\n  \"schemaVersion\": 1,\n  \"dryRun\": true,\n  \"plan\": {\n    \"cwd\": \"/home/dev/repo\",\n    \"tag\": \"1.2.3\",\n    \"allowEmptyRelease\": false,\n    \"baseBranch\": \"main\",\n    \"releaseBranch\": \"changelog/1.2.3\",\n    \"gitExecutable\": \"git\",\n    \"gitUserName\": \"github-actions[bot]\",\n    \"gitUserEmail\": \"github-actions[bot]@users.noreply.github.com\",\n    \"signCommit\": false,\n    \"releaseCommand\": \"./node_modules/.bin/release-it\",\n    \"releaseArgs\": [],\n    \"skipRelease\": false,\n    \"resetReleaseBranch\": false,\n    \"githubTokenEnv\": \"GITHUB_TOKEN\",\n    \"githubApiUrl\": \"https://api.github.com\",\n    \"autoMergePr\": false,\n    \"mergeMethod\": \"merge\",\n    \"deleteMergedBranch\": false,\n    \"skipPr\": false,\n    \"skipPreflight\": false,\n    \"tokenSource\": \"none\",\n    \"tokenAvailable\": false,\n    \"dryRun\": true,\n    \"only\": [\"determine\", \"release\", \"pr\"],\n    \"timeoutMs\": 60000,\n    \"maxOutputBytes\": 1048576\n  },\n  \"determined\": null,\n  \"release\": null,\n  \"pullRequest\": null\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Execution results use the same envelope without ", (0,jsx_runtime.jsx)(_components.code, {
        children: "dryRun"
      }), ": ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determined"
      }), " is ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{ version, tagVersion, bump, lastTag, manual, noChanges }"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release"
      }), " is ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{ baseBranch, releaseBranch, releaseRan, releasedHead?, skippedReason, tagMessage, prTitle }"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "pullRequest"
      }), " is ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{ skipped, skippedReason, number, url, reused, merged, branchDeleted }"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "library-reference",
      children: "Library reference"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import { runReleaseTag, resolveReleaseTagPlan } from '@repo-toolkit/release-tag';\n\nconst plan = resolveReleaseTagPlan({ tag: 'v1.2.3' });\nconst outcome = await runReleaseTag({ tag: 'v1.2.3', baseBranch: 'main' });\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Exports: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "resolveReleaseTagPlan"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runReleaseTag"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determineNextTag"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runReleaseBranch"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "createReleasePullRequest"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runPreflight"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "formatPullRequestBody"
      }), ", plus ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ReleaseTagOptions"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ReleaseTagPlan"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ReleaseTagStage"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ReleaseTagMergeMethod"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ReleaseTagTokenSource"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "DeterminedTag"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "DetermineNextTagInput"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ReleaseBranchResult"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "RunReleaseBranchInput"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "PullRequestResult"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "CreateReleasePullRequestInput"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "PreflightResult"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "PreflightCheckResult"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "RunPreflightInput"
      }), " types. All runners accept ", (0,jsx_runtime.jsx)(_components.code, {
        children: "options = {}"
      }), " defaults; ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runner"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "fetchFn"
      }), " are injectable for tests."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "resolveReleaseTagPlan(options = {})"
      }), " validates without I/O or network and never embeds token bytes. Returned orchestration plans are sanitized data snapshots; execution plans retain nonenumerable transports with safe resolved-time JSON/inspection snapshots. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runReleaseTag(options = {})"
      }), " returns ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{ plan, determined, release, pullRequest }"
      }), ". Lower-level ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determineNextTag"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runReleaseBranch"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "createReleasePullRequest"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runPreflight"
      }), " accept ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{ plan, ... }"
      }), " with optional runner/fetch overrides and are the seam for fake-runner and fake-fetch tests. Direct stages accept an optional ", (0,jsx_runtime.jsx)(_components.code, {
        children: "githubToken"
      }), " on their ", (0,jsx_runtime.jsx)(_components.strong, {
        children: "stage input"
      }), "; a token passed only to plan resolution is never retained for later execution. Direct-stage composition must honor ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determined.noChanges"
      }), " before invoking downstream stages, and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runReleaseTag"
      }), " already bypasses runtime identity inference, preflight, token-file resolution, release, and PR on the no-change path."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "examples",
      children: "Examples"
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "full-pipeline-from-git-history",
      children: "Full pipeline from git history"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Derive the bump from Conventional Commits since the latest tag, run ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release-it"
      }), " on ", (0,jsx_runtime.jsx)(_components.code, {
        children: "changelog/<version>"
      }), ", and open the PR:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --base-branch main\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "From the monorepo root via the workspace script:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "pnpm release-tag -- --base-branch main\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "seed-history-with-an-explicit-version",
      children: "Seed history with an explicit version"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Run once when no previous tag exists, then omit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--tag"
      }), " afterwards:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --tag 1.2.3 --base-branch main\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "v1.2.3"
      }), " is accepted too; exactly one leading ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v"
      }), " is stripped. Manual versions are always explicit release requests, even when the range is empty."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "automatic-run-with-no-changes",
      children: "Automatic run with no changes"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["When no commits follow the last tag, the default run returns the current version with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "noChanges: true"
      }), " and skips preflight, release, and PR work:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --base-branch main\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-text",
        children: "determine: version 1.2.3 tag v1.2.3 bump none manual false noChanges true lastTag v1.2.3\nrelease: skipped (no changes)\npullRequest: skipped (no changes)\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "To deliberately cut an empty patch release instead, opt in explicitly:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --base-branch main --allow-empty-release\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "environment-setup",
      children: "Environment setup"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Auth, repository, and base branch resolve from the environment, so local runs need no secret flags:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "export GITHUB_TOKEN=ghp_example\nexport GITHUB_REPOSITORY=octocat/hello\nexport GITHUB_REF_NAME=main\nrepo-toolkit-release-tag\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Prefer a token file over env or argv when the token lives on disk:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "printf '%s' \"$GITHUB_TOKEN\" > ./token.txt\nrepo-toolkit-release-tag --github-token-file ./token.txt --github-repository octocat/hello\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "run-stages-individually",
      children: "Run stages individually"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --only determine\nrepo-toolkit-release-tag --only determine,release\nrepo-toolkit-release-tag --only determine --only release\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "--only"
      }), " is repeatable and comma-split. Unselected stages yield ", (0,jsx_runtime.jsx)(_components.code, {
        children: "null"
      }), ". Downstream stages require their upstream prefix: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--only release"
      }), " alone, or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--only determine,pr"
      }), ", throws with guidance. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--only pr"
      }), " alone is valid only as ", (0,jsx_runtime.jsx)(_components.a, {
        href: "#pr-only-recovery",
        children: "PR-only recovery"
      }), " with explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--tag"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--base-branch"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "skip-the-release-command-or-the-pr",
      children: "Skip the release command or the PR"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Create and push the branch but skip the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release-it"
      }), " invocation:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --base-branch main --skip-release\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Run determine plus release but skip PR creation:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --base-branch main --skip-pr\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Unlike ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--only"
      }), ", skipped stages still run and return a skipped result with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "skippedReason"
      }), ", so callers can tell not-selected (", (0,jsx_runtime.jsx)(_components.code, {
        children: "null"
      }), ") apart from selected-but-skipped."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "auto-merge-the-release-pr",
      children: "Auto-merge the release PR"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Merge immediately after creation and delete the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "changelog/*"
      }), " branch, matching ", (0,jsx_runtime.jsx)(_components.code, {
        children: "auto-merge-pr"
      }), " plus ", (0,jsx_runtime.jsx)(_components.code, {
        children: "delete-merged-branch"
      }), " in the reference action:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --base-branch main --auto-merge-pr --delete-merged-branch\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "--delete-merged-branch"
      }), " without ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--auto-merge-pr"
      }), " is ignored; the branch is never deleted unless the merge succeeded with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "merged === true"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "squash-only-repositories",
      children: "Squash-only repositories"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Repositories that only allow squash merges select the method explicitly; the merge still pins the validated head SHA and requires ", (0,jsx_runtime.jsx)(_components.code, {
        children: "merged === true"
      }), ":"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --base-branch main --auto-merge-pr --merge-method squash --delete-merged-branch\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Use ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--merge-method rebase"
      }), " for rebase-only repositories. Unsupported methods and branch-protection rejections fail without deleting the branch."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "signed-release-commits",
      children: "Signed release commits"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Prepare the key outside the tool, then sign the release commit:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --base-branch main --sign-commit \\\n  --git-user-name release-bot \\\n  --git-user-email release-bot@example.com\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["This sets ", (0,jsx_runtime.jsx)(_components.code, {
        children: "commit.gpgsign=true"
      }), " and passes ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--gpg-sign"
      }), " to the release command. The runner must already hold a usable secret key; the tool never imports keys or sets ", (0,jsx_runtime.jsx)(_components.code, {
        children: "user.signingkey"
      }), ". See ", (0,jsx_runtime.jsx)(_components.a, {
        href: "#signing-with-externally-prepared-keys",
        children: "Signing with externally prepared keys"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "recover-after-a-label-merge-or-deletion-failure",
      children: "Recover after a label, merge, or deletion failure"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "When the release and its tag already exist but the PR step failed partway, resume only the PR stage from the verified local identity:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --only pr --tag 1.2.3 --base-branch main --auto-merge-pr --delete-merged-branch\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "This rediscovers the exact matching PR, reapplies labels, retries the SHA-pinned merge, and resumes ref cleanup. Never rerun the full release (the existing tag would correctly refuse a second release) and never delete the release tag to force a retry."
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "dry-run-preview",
      children: "Dry-run preview"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --tag 1.2.3 --base-branch main --dry-run\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Prints the resolved plan without spawning processes or network (exit 0); see ", (0,jsx_runtime.jsx)(_components.a, {
        href: "#cli-reference",
        children: "CLI reference"
      }), " for the full summary shape. Add ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--json"
      }), " for the machine-readable form (", (0,jsx_runtime.jsx)(_components.code, {
        children: "schemaVersion: 1"
      }), ", secret-free plan, null stage results)."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "library-per-stage-composition",
      children: "Library per-stage composition"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import {\n  createReleasePullRequest,\n  determineNextTag,\n  resolveReleaseTagPlan,\n  runReleaseBranch,\n} from '@repo-toolkit/release-tag';\n\nconst plan = resolveReleaseTagPlan({ baseBranch: 'main' });\nconst determined = await determineNextTag({ plan });\nconsole.log(determined);\n// { version: '1.3.0', tagVersion: 'v1.3.0', bump: 'minor', lastTag: 'v1.2.3', manual: false, noChanges: false }\n\nif (!determined.noChanges) {\n  const release = await runReleaseBranch({ plan, determined });\n  console.log(release.releaseBranch, release.prTitle);\n  // changelog/1.3.0 chore(release): release candidate v1.3.0\n\n  const pullRequest = await createReleasePullRequest({\n    plan,\n    determined,\n    release,\n    githubToken: process.env.GITHUB_TOKEN,\n  });\n  console.log(pullRequest.url, pullRequest.merged, pullRequest.branchDeleted);\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "runReleaseTag"
      }), " does exactly this composition, including the no-change bypass; call the stages directly when you need values between stages or dry-run git reads (see ", (0,jsx_runtime.jsx)(_components.a, {
        href: "#dry-run",
        children: "Dry-run"
      }), ")."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "testing-with-fake-runners-vitest",
      children: "Testing with fake runners (vitest)"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Every stage accepts an injected runner or fetch, so tests need no git daemon or network. Stage 1 with a scripted fake runner, using the NUL-delimited record format the implementation reads:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import { describe, expect, it } from 'vitest';\n\nimport type { CapturingProcessRunner, ProcessCaptureResult } from '@repo-toolkit/publish-package';\nimport { determineNextTag, resolveReleaseTagPlan } from '@repo-toolkit/release-tag';\n\nfunction scriptedRunner(outputs: string[]): CapturingProcessRunner {\n  let index = 0;\n  return {\n    run() {\n      throw new Error('unexpected run call');\n    },\n    runShell() {\n      throw new Error('must not invoke a shell');\n    },\n    async capture(): Promise<ProcessCaptureResult> {\n      const stdout = outputs[index];\n      index += 1;\n      if (stdout === undefined) {\n        throw new Error('script exhausted');\n      }\n      return { stdout, stderr: '', code: 0 };\n    },\n  };\n}\n\ndescribe('determineNextTag', () => {\n  it('bumps minor on feat commits', async () => {\n    const plan = resolveReleaseTagPlan({ cwd: '/fake/workdir' });\n    const commitId = 'a'.repeat(40);\n    const runner = scriptedRunner(['v1.2.3\\n', `${commitId}\\0feat: add widget\\0`]);\n    const determined = await determineNextTag({ plan, runner });\n    expect(determined).toMatchObject({ version: '1.3.0', bump: 'minor', manual: false, noChanges: false });\n  });\n});\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Stage 3 with a real ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Response"
      }), " fake fetch (the implementation streams response bodies, so prefer real responses over minimal stubs; see ", (0,jsx_runtime.jsx)(_components.code, {
        children: "test/http-fixture.ts"
      }), " in the package):"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import { createReleasePullRequest, resolveReleaseTagPlan } from '@repo-toolkit/release-tag';\n\nconst seen: string[] = [];\nconst fetchFn = (async (url: unknown) => {\n  seen.push(String(url));\n  if (seen.length === 1) {\n    return new Response('[]', { status: 200 });\n  }\n  return new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/octocat/hello/pull/7' }), {\n    status: 201,\n  });\n}) as unknown as typeof fetch;\n\nconst plan = resolveReleaseTagPlan({ githubRepository: 'octocat/hello' });\nconst result = await createReleasePullRequest({\n  plan,\n  determined: {\n    version: '1.2.3',\n    tagVersion: 'v1.2.3',\n    bump: 'minor',\n    lastTag: 'v1.2.2',\n    manual: false,\n    noChanges: false,\n  },\n  release: {\n    baseBranch: 'main',\n    releaseBranch: 'changelog/1.2.3',\n    releaseRan: true,\n    skippedReason: null,\n    tagMessage: 'Release 1.2.3 notes',\n    prTitle: 'chore(release): release candidate v1.2.3',\n  },\n  githubToken: 'fake-token-for-tests',\n  fetchFn,\n});\nexpect(result).toMatchObject({ skipped: false, number: 7 });\nexpect(seen[0]).toContain('/repos/octocat/hello/pulls');\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Stage 2 follows the same queue pattern with one canned ", (0,jsx_runtime.jsx)(_components.code, {
        children: "capture"
      }), " result per git invocation plus a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "capture"
      }), " handler for the release command; every invocation — including release execution — goes through ", (0,jsx_runtime.jsx)(_components.code, {
        children: "capture"
      }), ", never ", (0,jsx_runtime.jsx)(_components.code, {
        children: "run"
      }), ". See ", (0,jsx_runtime.jsx)(_components.code, {
        children: "test/release.test.ts"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "test/release-fixture.ts"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "test/run.test.ts"
      }), " in the package for full scripted coverage, including merge/delete flows."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "github-actions-workflow",
      children: "GitHub Actions workflow"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Serialize releases so only one runs at a time, and never cancel an active release mid-push: a cancelled job can strand a pushed branch or tag that a retry must then handle deliberately."
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-yaml",
        children: "name: Release\n\non:\n  workflow_dispatch:\n\nconcurrency:\n  group: release-tag\n  cancel-in-progress: false\n\njobs:\n  release:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n      pull-requests: write\n      issues: write\n\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n          fetch-tags: true\n\n      - run: pnpm install --frozen-lockfile\n\n      - run: pnpm release-tag -- --base-branch main --github-repository ${{ github.repository }}\n        env:\n          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Add ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--auto-merge-pr --delete-merged-branch"
      }), " to merge the release PR immediately. The checkout needs full history and tags so stage 1 can read ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git describe"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git log"
      }), ". The repository's own signed dispatch workflow is documented separately in the ", (0,jsx_runtime.jsx)(_components.a, {
        href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-dispatch.md",
        children: "release-tag dispatch notes"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "dry-run",
      children: "Dry-run"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["CLI ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--dry-run"
      }), " resolves and prints the plan summary and exits 0 without mutations, processes, or network. It reports ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determined: null"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release: null"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "pullRequest: null"
      }), ", even with a manual ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--tag"
      }), ", so no git reads occur. Invalid stage selections fail identically in dry-run and execution. This differs from the library split: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determineNextTag"
      }), " always reads git state when called directly (reads are permitted in dry-run), ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runReleaseBranch"
      }), " with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "dryRun: true"
      }), " validates names and returns a dry-run skipped result with zero invocations but requires an explicit base or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_REF_NAME"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "createReleasePullRequest"
      }), " with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "dryRun: true"
      }), " returns a dry-run skipped result with zero fetch calls. Library callers that need dry-run git reads can call ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determineNextTag"
      }), " first, then pass the result to the later stages."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "troubleshooting",
      children: "Troubleshooting"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "No previous tag found and no tag input provided."
        }), " Seed history once with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--tag 1.2.3"
        }), ", then omit ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--tag"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "Last tag '<tag>' does not follow 'vX.Y.Z' format."
        }), " Rename or delete the non-conforming tag; leading zeros and prereleases are rejected."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "This workflow must be run on a branch, not a tag."
        }), " Run on a branch, or pass ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--base-branch main"
        }), "; tag-shaped ", (0,jsx_runtime.jsx)(_components.code, {
          children: "GITHUB_REF_NAME"
        }), " values and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "GITHUB_REF_TYPE=tag"
        }), " checkouts are rejected."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "baseBranch could not be resolved in dry-run without git."
        }), " Pass ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--base-branch"
        }), " or set ", (0,jsx_runtime.jsx)(_components.code, {
          children: "GITHUB_REF_NAME"
        }), " for dry-run branch validation."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "preflight failed: git ls-remote origin HEAD did not succeed."
        }), " Non-interactive git auth is missing (usually a passphrase-protected SSH key with no agent). Load the key (", (0,jsx_runtime.jsx)(_components.code, {
          children: "eval \"$(ssh-agent -s)\" && ssh-add ~/.ssh/<key>"
        }), "), verify with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "GIT_SSH_COMMAND=\"ssh -o BatchMode=yes\" git ls-remote origin HEAD"
        }), ", then retry. See ", (0,jsx_runtime.jsx)(_components.a, {
          href: "#prerequisites",
          children: "Prerequisites"
        }), ". Nothing was mutated."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "Release command '<cmd>' is not available."
        }), " Install or correct ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--release-command"
        }), "; nothing was mutated. Use ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--skip-release"
        }), " only for deliberate branch preparation without a command."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "Release branch '<branch>' already exists locally or on origin."
        }), " Inspect the existing work; choose another ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--release-branch"
        }), " or pass ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--reset-release-branch"
        }), " for an intentional restart with an observed remote lease. Nothing was overwritten."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "Release tag '<tag>' already exists locally or on origin."
        }), " Choose a new version. Never delete or overwrite a release tag to force a retry; use ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--skip-release"
        }), " only for deliberate preparation with existing metadata, or ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--only pr"
        }), " to resume the PR step."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "Release source validation: ..."
        }), " The selected local base is not checked out cleanly at its inspected commit. Check out the intended base branch, commit/stash/remove pending work, and retry. Detached, tag, and wrong-branch checkouts cannot be released."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "Local <ref> is a symbolic ref."
        }), " / ", (0,jsx_runtime.jsx)(_components.code, {
          children: "Origin <ref> is a symbolic ref."
        }), " Replace the aliased ref with an independent branch ref; symbolic aliases are refused so a reset can never move the base."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "githubRepository is required."
        }), " Pass ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--github-repository owner/repo"
        }), " or set ", (0,jsx_runtime.jsx)(_components.code, {
          children: "GITHUB_REPOSITORY"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "githubTokenFile at <path> is empty."
        }), " (and oversized, invalid-header, nonregular, or unreadable variants) The file must be a regular file of at most 65,536 raw bytes trimming to one ASCII bearer token. Invalid files throw without env fallback; fix the file and retry."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "preflight failed: GitHub token check ..."
        }), " Either the token is invalid (non-2xx, including permission-404s) or it lacks push permission and is not an installation token. Grant Contents, Pull requests, and Issues read/write on the repo as listed in ", (0,jsx_runtime.jsx)(_components.a, {
          href: "#prerequisites",
          children: "Prerequisites"
        }), ", verify with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "GH_TOKEN=$(cat ./token.txt) gh api repos/octocat/hello --jq .permissions"
        }), ", then retry. Nothing was mutated."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "GitHub API response ... exceeding the ...-byte response limit."
        }), " Lower history or raise ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--max-output-bytes"
        }), "; the PR cap is ", (0,jsx_runtime.jsx)(_components.code, {
          children: "min(maxOutputBytes, 1MiB)"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "The matching PR is closed without merging."
        }), " Inspect and reopen that PR, or choose a new release identity; it is not replaced automatically."]
      }), "\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "Multiple or ambiguous matching PRs. Inspect the duplicates and resolve them manually; discovery refuses to select one automatically."
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Merge ", (0,jsx_runtime.jsx)(_components.code, {
          children: "405"
        }), "/", (0,jsx_runtime.jsx)(_components.code, {
          children: "422"
        }), " or unsupported-method errors. Branch protection, required reviews/checks, or a non-mergeable state; the stage fails without deleting the branch."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Recovery ", (0,jsx_runtime.jsx)(_components.code, {
          children: "tag ... not found"
        }), " / head-mismatch errors from ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--only pr"
        }), ". The local tag, local branch, and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "origin"
        }), " branch disagree. Inspect them with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git show-ref"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git status --short --branch"
        }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git ls-remote origin"
        }), "; fix the checkout or publish the missing state, then resume recovery. Recovery never fetches or reconstructs refs."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Numeric/enum flag errors (", (0,jsx_runtime.jsx)(_components.code, {
          children: "--timeout-ms must be ..."
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--max-output-bytes must be ..."
        }), ", unknown merge method). Use decimal digits only without leading zeros (", (0,jsx_runtime.jsx)(_components.code, {
          children: "1..2147483647"
        }), " for ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--timeout-ms"
        }), ", positive safe integers for ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--max-output-bytes"
        }), ") and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "merge"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "squash"
        }), ", or ", (0,jsx_runtime.jsx)(_components.code, {
          children: "rebase"
        }), " for ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--merge-method"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Stuck release command (only possible past a skipped or exotic preflight, since the default preflight catches missing non-interactive auth). Release output is captured, so a hidden SSH passphrase prompt surfaces as a hang until ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--timeout-ms"
        }), " terminates the child. Assess with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git status --short --branch"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git log --oneline -3"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git tag -l"
        }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git ls-remote origin"
        }), "; inspect whether the executable published the branch or tag. Either resume the PR step with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--only pr --tag <version> --base-branch <base>"
        }), " once the tag and branch exist, or retry cleanly from the base branch after loading ssh-agent. Never delete the release tag as part of the retry."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "could not add label: '<tag>' not found"
        }), " from ", (0,jsx_runtime.jsx)(_components.code, {
          children: "gh pr create --label"
        }), ". ", (0,jsx_runtime.jsx)(_components.code, {
          children: "gh"
        }), " validates labels client-side and requires them to pre-exist; create them first (", (0,jsx_runtime.jsx)(_components.code, {
          children: "gh label create"
        }), ") or use ", (0,jsx_runtime.jsx)(_components.code, {
          children: "gh api repos/octocat/hello/issues/<n>/labels"
        }), ", which auto-creates missing labels exactly like the tool's own REST call."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "migration",
      children: "Migration"
    }), "\n", (0,jsx_runtime.jsxs)(_components.h3, {
      id: "migration-from-egoseactionsrelease-tag",
      children: ["Migration from ", (0,jsx_runtime.jsx)(_components.code, {
        children: "egose/actions/release-tag"
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "Action input"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "CLI flag"
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "tag"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--tag"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "release-it-path"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "--release-it-path"
            }), " (alias for ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--release-command"
            }), ")"]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "git-user-name"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--git-user-name"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "git-user-email"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--git-user-email"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "sign-commit"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--sign-commit"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "github-token"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "--github-token-file"
            }), " (preferred) or ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--github-token"
            })]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "auto-merge-pr"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--auto-merge-pr"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "delete-merged-branch"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--delete-merged-branch"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "skip-release"
            }), " (when present)"]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--skip-release"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "skip-pr"
            }), " (when present)"]
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "--skip-pr"
            })
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["New flags with no action equivalent: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--release-arg"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--timeout-ms"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--max-output-bytes"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--reset-release-branch"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--allow-empty-release"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--merge-method"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--only"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--dry-run"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--json"
      }), "."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Behavioral deltas are intentional: manual tags strip one leading ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v"
      }), " instead of every ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v"
      }), "; branch names and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "owner/repo"
      }), " values are strictly validated and environment values are no longer trimmed; the base branch must be checked out cleanly and creation uses its verified commit; existing release branches and tags refuse by default instead of blind deletion or silent overwrite; missing release commands fail before mutation; version bumps follow per-commit Conventional Commit boundaries instead of whole-output shell regexes; empty ranges return ", (0,jsx_runtime.jsx)(_components.code, {
        children: "noChanges"
      }), " instead of a patch; ", (0,jsx_runtime.jsx)(_components.code, {
        children: "signCommit"
      }), " never imports GPG keys; merges pin the validated head SHA and require ", (0,jsx_runtime.jsx)(_components.code, {
        children: "merged === true"
      }), "; ", (0,jsx_runtime.jsx)(_components.code, {
        children: "githubApiUrl"
      }), " plus ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_API_URL"
      }), " support GitHub Enterprise REST without ", (0,jsx_runtime.jsx)(_components.code, {
        children: "gh"
      }), "; and PRs are reused idempotently with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--only pr"
      }), " recovery. The PR title, body template, and label set match the action."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "review-remediation-contract-changes",
      children: "Review remediation contract changes"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "The remediation review (RTR-01 through RTR-07) changed these externally visible contracts; each link records the exact migration:"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.a, {
          href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-01-stricter-ref-and-stage-payload-validation",
          children: "Stricter ref and payload validation"
        }), ": option-shaped/full/traversal refs, ", (0,jsx_runtime.jsx)(_components.code, {
          children: "HEAD"
        }), ", base/release equality, tag-shaped bases, untrimmed env values, safe-integer versions, exact payload identity, strict ", (0,jsx_runtime.jsx)(_components.code, {
          children: "owner/repo"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.a, {
          href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-02-verified-source-preparation-and-release-postconditions",
          children: "Verified source preparation"
        }), ": clean checked-out base, collision refusal with leased ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--reset-release-branch"
        }), ", symbolic-alias refusal, command availability before mutation, immutable tags, executed-release postconditions, ", (0,jsx_runtime.jsx)(_components.code, {
          children: "releasedHead"
        }), ", nontransactional limits."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.a, {
          href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-03-bounded-captured-process-execution",
          children: "Bounded captured execution"
        }), ": per-command ", (0,jsx_runtime.jsx)(_components.code, {
          children: "timeoutMs"
        }), "/", (0,jsx_runtime.jsx)(_components.code, {
          children: "maxOutputBytes"
        }), ", captured release output, POSIX termination/cleanup limits, SSH preservation, ", (0,jsx_runtime.jsx)(_components.code, {
          children: "capture"
        }), "-only custom runners."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.a, {
          href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-04-private-credentials-and-bounded-github-transport",
          children: "Private credentials and bounded transport"
        }), ": ASCII bearer tokens, 64 KiB file cap, pinned per-run credentials, streamed ", (0,jsx_runtime.jsx)(_components.code, {
          children: "min(maxOutputBytes, 1MiB)"
        }), " bodies, disabled redirects, loopback-only HTTP, sanitized diagnostics, custom-fetch responsibilities."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.a, {
          href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-05-recoverable-pr-lifecycle-and-verified-merges",
          children: "Recoverable PR lifecycle"
        }), ": exact PR reuse with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "reused"
        }), ", one create-conflict relookup, merge methods, SHA pinning, ", (0,jsx_runtime.jsx)(_components.code, {
          children: "merged === true"
        }), ", already-merged cleanup recovery, non-atomic GET/DELETE limits."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.a, {
          href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-06-conventional-commit-boundaries-and-no-change-releases",
          children: "Conventional Commit boundaries and no-change releases"
        }), ": per-record classification, breaking-footer rules, ", (0,jsx_runtime.jsx)(_components.code, {
          children: "noChanges"
        }), "/", (0,jsx_runtime.jsx)(_components.code, {
          children: "allowEmptyRelease"
        }), ", NUL-delimited runner format, safe-integer bump validation."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.a, {
          href: "https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-07-pr-only-recovery-and-thin-cli",
          children: "PR-only recovery and thin CLI"
        }), ": read-only ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--only pr"
        }), " composition, new flags, import-safe helpers, parse redaction, schema-1 retention."]
      }), "\n"]
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