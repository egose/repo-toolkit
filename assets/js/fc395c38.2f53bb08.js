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
const site_docs_packages_release_tag_md_fc3_namespaceObject = /*#__PURE__*/JSON.parse('{"id":"packages/release-tag","title":"@repo-toolkit/release-tag","description":"@repo-toolkit/release-tag determines the next X.Y.Z release tag from Conventional Commits, runs the release command on a changelog/ branch, and opens a GitHub release pull request. It ports egose/actions/release-tag into one repo-toolkit-release-tag executable with an injectable process runner and fetch transport, so every stage is unit-testable without a git daemon or network.","source":"@site/docs/packages/release-tag.md","sourceDirName":"packages","slug":"/packages/release-tag","permalink":"/docs/packages/release-tag","draft":false,"unlisted":false,"tags":[],"version":"current","sidebarPosition":9,"frontMatter":{"sidebar_label":"Release Tag","sidebar_position":9},"sidebar":"packagesSidebar","previous":{"title":"Secret Sync","permalink":"/docs/packages/secret-sync"}}');
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
  "value": "How the three stages fit",
  "id": "how-the-three-stages-fit",
  "level": 2
}, {
  "value": "Versioning rules",
  "id": "versioning-rules",
  "level": 2
}, {
  "value": "Branch naming",
  "id": "branch-naming",
  "level": 2
}, {
  "value": "Release-command contract",
  "id": "release-command-contract",
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
  "value": "GPG notes",
  "id": "gpg-notes",
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
  "value": "Signed release commits",
  "id": "signed-release-commits",
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
  "value": "Migration from <code>egose/actions/release-tag</code>",
  "id": "migration-from-egoseactionsrelease-tag",
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
    p: "p",
    pre: "pre",
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
      }), " release tag from Conventional Commits, runs the release command on a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "changelog/<version>"
      }), " branch, and opens a GitHub release pull request. It ports ", (0,jsx_runtime.jsx)(_components.code, {
        children: "egose/actions/release-tag"
      }), " into one ", (0,jsx_runtime.jsx)(_components.code, {
        children: "repo-toolkit-release-tag"
      }), " executable with an injectable process runner and fetch transport, so every stage is unit-testable without a git daemon or network."]
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
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ssh -o BatchMode=yes"
      }), ", unless you already set ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GIT_SSH_COMMAND"
      }), " — a preset value is respected and never overridden."]
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
      }), ", so a 404 from a labels or repo endpoint means the token lacks access. Verify a token file before relying on it:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "GH_TOKEN=$(cat ./token.txt) gh api repos/owner/repo --jq .permissions\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "push"
      }), " must be ", (0,jsx_runtime.jsx)(_components.code, {
        children: "true"
      }), ". The value never lands in shell history with this form."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "how-the-three-stages-fit",
      children: "How the three stages fit"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "runReleaseTag"
      }), " resolves a validated plan, then runs ", (0,jsx_runtime.jsx)(_components.code, {
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
      }), " means not-selected while a skipped result means selected-but-skipped. Downstream stages require their upstream stages: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "only: ['release']"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "only: ['pr']"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "only: ['determine', 'pr']"
      }), " throw with guidance to select the prefix. After determine and before any mutation, a preflight verifies non-interactive git auth (when ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release"
      }), " is selected) and token validity plus push permission (when ", (0,jsx_runtime.jsx)(_components.code, {
        children: "pr"
      }), " is selected, not skipped, and a token is available); a missing token still yields the graceful stage-3 skip rather than a preflight error. Any throw propagates with secrets redacted and stops later stages. Token bytes never appear in plans, results, JSON output, or errors."]
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
      }), " with no leading zeros and no prerelease or build metadata. ", (0,jsx_runtime.jsx)(_components.code, {
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
      }), " character."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Without a manual tag, stage 1 runs ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git describe --tags --abbrev=0"
      }), " for the latest tag, requires ", (0,jsx_runtime.jsx)(_components.code, {
        children: "vX.Y.Z"
      }), " on the trimmed first line, then runs ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git log <lastTag>..HEAD --pretty=format:%B"
      }), " and applies the exact shell bump regexes in order: major on ", (0,jsx_runtime.jsx)(_components.code, {
        children: "BREAKING CHANGE:"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "feat(...)!:"
      }), " , ", (0,jsx_runtime.jsx)(_components.code, {
        children: "fix(...)!:"
      }), " , or any ", (0,jsx_runtime.jsx)(_components.code, {
        children: "!:"
      }), "; else minor on ", (0,jsx_runtime.jsx)(_components.code, {
        children: "feat:"
      }), " with an optional scope; else patch. Matching is multiline. Any ", (0,jsx_runtime.jsx)(_components.code, {
        children: "!:"
      }), " inside a scope or subject triggers major, matching the shell quirk. Empty history yields patch. Missing previous tags throw with guidance to provide ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--tag"
      }), " once to seed history. Output over ", (0,jsx_runtime.jsx)(_components.code, {
        children: "maxOutputBytes"
      }), " throws. Commit bodies are used only for the bump decision and never returned."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "branch-naming",
      children: "Branch naming"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The release branch defaults to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "changelog/<version>"
      }), " where ", (0,jsx_runtime.jsx)(_components.code, {
        children: "<version>"
      }), " is the bare version without ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v"
      }), ". An explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "releaseBranch"
      }), " must be non-empty, contain no whitespace or NUL, and must not be ", (0,jsx_runtime.jsx)(_components.code, {
        children: "HEAD"
      }), "."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The base branch resolves from explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "baseBranch"
      }), " > non-empty ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_REF_NAME"
      }), " > ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git symbolic-ref --short HEAD"
      }), " (trimmed first line). Empty values, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "HEAD"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "refs/tags/*"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "vX.Y.Z"
      }), " tag shapes throw ", (0,jsx_runtime.jsx)(_components.code, {
        children: "This workflow must be run on a branch, not a tag."
      }), " Detached HEAD, including spawn failures, throws the same guard with a truncated stderr tail. Branch names starting with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v"
      }), " that are not strict tags (for example ", (0,jsx_runtime.jsx)(_components.code, {
        children: "version-next"
      }), ") are accepted."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The branch reset runs with explicit arg arrays, never a shell: best-effort ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git push origin --delete <branch>"
      }), ", best-effort ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git branch -D <branch>"
      }), ", fatal ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git checkout -b <branch>"
      }), ", fatal ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git push --set-upstream origin <branch>"
      }), ". The exact sequence is observable through a fake runner in tests."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "release-command-contract",
      children: "Release-command contract"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The default command is ", (0,jsx_runtime.jsx)(_components.code, {
        children: "./node_modules/.bin/release-it"
      }), ". Extra ", (0,jsx_runtime.jsx)(_components.code, {
        children: "releaseArgs"
      }), " are appended after ", (0,jsx_runtime.jsx)(_components.code, {
        children: "<version> --ci"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--git.commitArgs=--gpg-sign"
      }), " is appended when ", (0,jsx_runtime.jsx)(_components.code, {
        children: "signCommit"
      }), " is true. The command runs via ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runner.run"
      }), " to stream output, while git plumbing uses ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runner.capture"
      }), ". A stage-2 runner must implement ", (0,jsx_runtime.jsx)(_components.code, {
        children: "capture"
      }), "."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Availability is checked before execution. When ", (0,jsx_runtime.jsx)(_components.code, {
        children: "releaseCommand"
      }), " contains ", (0,jsx_runtime.jsx)(_components.code, {
        children: "/"
      }), ", the path is resolved against ", (0,jsx_runtime.jsx)(_components.code, {
        children: "cwd"
      }), " and checked with executable access. When it is a bare name, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "<cmd> --version"
      }), " is probed via capture with a timeout of ", (0,jsx_runtime.jsx)(_components.code, {
        children: "min(timeoutMs, 10s)"
      }), "; non-zero exits and spawn errors mean unavailable. Missing commands skip with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release command not available: <cmd>"
      }), " without failing. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "skipRelease"
      }), " skips with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "skipped via skipRelease"
      }), ", and an unselected stage skips with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "stage not selected"
      }), " when the stage is invoked directly. The branch is always created and pushed, and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git tag -l --format=%(contents) <tagVersion>"
      }), " is always read (empty output tolerated); only the release invocation is conditional. The PR title is always ", (0,jsx_runtime.jsx)(_components.code, {
        children: "chore(release): release candidate <tagVersion>"
      }), "."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Dry-run performs zero runner invocations and returns ", (0,jsx_runtime.jsx)(_components.code, {
        children: "releaseRan: false"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "skippedReason: 'dry-run'"
      }), ", and an empty tag message. It still validates names and requires an explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "baseBranch"
      }), " or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_REF_NAME"
      }), ", because no git fallback is attempted; without either it throws."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "pr-template-and-labels",
      children: "PR template and labels"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Stage-3 skips without network in this order: ", (0,jsx_runtime.jsx)(_components.code, {
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
      }), ". An empty file throws without falling back to env, and an unreadable file throws without network calls. The token travels only in the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Authorization: Bearer"
      }), " header."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The repository resolves from explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "githubRepository"
      }), " > ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_REPOSITORY"
      }), ". Both must use ", (0,jsx_runtime.jsx)(_components.code, {
        children: "owner/repo"
      }), " with no empty segments, whitespace, or extra slashes. Git remotes are not parsed in v1."]
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
      }), "."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["REST calls use ", (0,jsx_runtime.jsx)(_components.code, {
        children: "fetch"
      }), " against the trimmed ", (0,jsx_runtime.jsx)(_components.code, {
        children: "githubApiUrl"
      }), " with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Accept: application/vnd.github+json"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "X-GitHub-Api-Version: 2022-11-28"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "User-Agent: repo-toolkit-release-tag"
      }), ", and JSON content type: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "POST /repos/{owner}/{repo}/pulls"
      }), " with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "head"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "base"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "title"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "body"
      }), " (requires 200/201 with a numeric ", (0,jsx_runtime.jsx)(_components.code, {
        children: "number"
      }), " and string ", (0,jsx_runtime.jsx)(_components.code, {
        children: "html_url"
      }), "), then ", (0,jsx_runtime.jsx)(_components.code, {
        children: "POST /repos/{owner}/{repo}/issues/{number}/labels"
      }), ". Failures throw with the redacted status and a body truncated to 2048 chars. Responses are read as text and refused over ", (0,jsx_runtime.jsx)(_components.code, {
        children: "min(maxOutputBytes, 1MiB)"
      }), ". Requests use ", (0,jsx_runtime.jsx)(_components.code, {
        children: "AbortSignal.timeout(timeoutMs)"
      }), " with a timer fallback. There are no automatic retries."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "auto-merge-and-branch-deletion",
      children: "Auto-merge and branch deletion"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["When ", (0,jsx_runtime.jsx)(_components.code, {
        children: "autoMergePr"
      }), " is true, the stage sends ", (0,jsx_runtime.jsx)(_components.code, {
        children: "PUT /repos/{owner}/{repo}/pulls/{number}/merge"
      }), " with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{ merge_method: 'merge' }"
      }), ". Any non-2xx, including branch-protection 405/422, is fatal. When both ", (0,jsx_runtime.jsx)(_components.code, {
        children: "autoMergePr"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "deleteMergedBranch"
      }), " are true and the merge succeeded, it sends ", (0,jsx_runtime.jsx)(_components.code, {
        children: "DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}"
      }), " with each slash-separated segment URL-encoded. Non-2xx is fatal. When ", (0,jsx_runtime.jsx)(_components.code, {
        children: "autoMergePr"
      }), " is false, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "deleteMergedBranch"
      }), " is ignored and the branch is never deleted, matching the shell contract."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "gpg-notes",
      children: "GPG notes"
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
      }), ". The runner must already hold a usable secret key. Full ", (0,jsx_runtime.jsx)(_components.code, {
        children: "gpg --import"
      }), " from env secrets is deferred to a follow-up."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "configuration-precedence-and-environment",
      children: "Configuration precedence and environment"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Each option resolves independently as CLI flag > explicit option > environment > built-in default. The CLI reads ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_API_URL"
      }), " as a fallback for ", (0,jsx_runtime.jsx)(_components.code, {
        children: "githubApiUrl"
      }), " only when ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--github-api-url"
      }), " is absent; the flag always wins. ", (0,jsx_runtime.jsx)(_components.code, {
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
        })]
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "--release-it-path"
      }), " is an alias for ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--release-command"
      }), " for action parity; when both appear, the last writer wins. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--sign-commit"
      }), " is negatable via ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--no-sign-commit"
      }), ". ", (0,jsx_runtime.jsx)(_components.code, {
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
      }), "; ", (0,jsx_runtime.jsx)(_components.code, {
        children: "redactSensitiveValues"
      }), " covers every error path plus ", (0,jsx_runtime.jsx)(_components.code, {
        children: "://...@"
      }), " URL credentials."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "cli-reference",
      children: "CLI reference"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --tag 1.2.3 --base-branch main\nrepo-toolkit-release-tag --only determine\nrepo-toolkit-release-tag --skip-release --skip-pr --dry-run\nrepo-toolkit-release-tag --dry-run --json\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Human output prints one line per stage with versions, branches, PR numbers and URLs, and skip reasons; unselected stages print ", (0,jsx_runtime.jsx)(_components.code, {
        children: "not selected"
      }), ". ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--json"
      }), " prints a single object with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "schemaVersion: 1"
      }), ", a secret-free plan summary (no ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runner"
      }), " or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "fetchFn"
      }), "), and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determined"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "release"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "pullRequest"
      }), " results. Errors print the redacted message to stderr and set ", (0,jsx_runtime.jsx)(_components.code, {
        children: "process.exitCode = 1"
      }), " without calling ", (0,jsx_runtime.jsx)(_components.code, {
        children: "process.exit"
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
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "resolveReleaseTagPlan(options = {})"
      }), " validates without I/O or network and never embeds token bytes. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runReleaseTag(options = {})"
      }), " returns ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{ plan, determined, release, pullRequest }"
      }), ". Lower-level ", (0,jsx_runtime.jsx)(_components.code, {
        children: "determineNextTag"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runReleaseBranch"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "createReleasePullRequest"
      }), " accept ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{ plan, ... }"
      }), " with optional runner and fetch overrides and are the seam for fake-runner and fake-fetch tests."]
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
      }), " is stripped."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "environment-setup",
      children: "Environment setup"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Auth, repository, and base branch resolve from the environment, so local runs need no secret flags:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "export GITHUB_TOKEN=ghp_example\nexport GITHUB_REPOSITORY=octo/hello\nexport GITHUB_REF_NAME=main\nrepo-toolkit-release-tag\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Prefer a token file over env or argv when the token lives on disk:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "printf '%s' \"$GITHUB_TOKEN\" > ./token.txt\nrepo-toolkit-release-tag --github-token-file ./token.txt --github-repository octo/hello\n"
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
      }), " or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--only pr"
      }), " alone throws with guidance."]
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
      }), " is ignored; the branch is never deleted unless the merge succeeded."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "signed-release-commits",
      children: "Signed release commits"
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
      }), " to the release command. The runner must already hold a usable GPG secret key; v1 never imports keys. For a GitHub ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Verified"
      }), " badge, upload the public key to the account matching ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--git-user-email"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "dry-run-preview",
      children: "Dry-run preview"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-release-tag --tag 1.2.3 --base-branch main --dry-run\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Prints the resolved plan without spawning processes or network (exit 0):"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-text",
        children: "dry-run: no processes spawned and no network calls made\nbaseBranch: main\nreleaseBranch: changelog/1.2.3\nreleaseCommand: ./node_modules/.bin/release-it\ntokenAvailable: false\ntokenSource: none\ndetermined: null (dry-run skips even stage-1 git reads)\nrelease: null\npullRequest: null\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Add ", (0,jsx_runtime.jsx)(_components.code, {
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
        children: "import {\n  createReleasePullRequest,\n  determineNextTag,\n  resolveReleaseTagPlan,\n  runReleaseBranch,\n} from '@repo-toolkit/release-tag';\n\nconst plan = resolveReleaseTagPlan({ baseBranch: 'main' });\nconst determined = await determineNextTag({ plan });\nconsole.log(determined);\n// { version: '1.3.0', tagVersion: 'v1.3.0', bump: 'minor', lastTag: 'v1.2.3', manual: false }\n\nconst release = await runReleaseBranch({ plan, determined });\nconsole.log(release.releaseBranch, release.prTitle);\n// changelog/1.3.0 chore(release): release candidate v1.3.0\n\nconst pullRequest = await createReleasePullRequest({\n  plan,\n  determined,\n  release,\n  githubToken: process.env.GITHUB_TOKEN,\n});\nconsole.log(pullRequest.url, pullRequest.merged, pullRequest.branchDeleted);\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "runReleaseTag"
      }), " does exactly this composition; call the stages directly when you need values between stages or dry-run git reads (see ", (0,jsx_runtime.jsx)(_components.a, {
        href: "#dry-run",
        children: "Dry-run"
      }), ")."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "testing-with-fake-runners-vitest",
      children: "Testing with fake runners (vitest)"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Every stage accepts an injected runner or fetch, so tests need no git daemon or network. Stage 1 with a scripted fake runner:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import { describe, expect, it } from 'vitest';\n\nimport type { CapturingProcessRunner, ProcessCaptureResult } from '@repo-toolkit/publish-package';\nimport { determineNextTag, resolveReleaseTagPlan } from '@repo-toolkit/release-tag';\n\nfunction scriptedRunner(outputs: string[]): CapturingProcessRunner {\n  let index = 0;\n  return {\n    run() {\n      throw new Error('unexpected run call');\n    },\n    runShell() {\n      throw new Error('must not invoke a shell');\n    },\n    async capture(): Promise<ProcessCaptureResult> {\n      const stdout = outputs[index];\n      index += 1;\n      if (stdout === undefined) {\n        throw new Error('script exhausted');\n      }\n      return { stdout, stderr: '', code: 0 };\n    },\n  };\n}\n\ndescribe('determineNextTag', () => {\n  it('bumps minor on feat commits', async () => {\n    const plan = resolveReleaseTagPlan({ cwd: '/fake/workdir' });\n    const runner = scriptedRunner(['v1.2.3\\n', 'feat: add widget\\n']);\n    const determined = await determineNextTag({ plan, runner });\n    expect(determined).toMatchObject({ version: '1.3.0', bump: 'minor', manual: false });\n  });\n});\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Stage 3 with a recording fake fetch (the implementation only reads ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ok"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "status"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "text()"
      }), ", so a minimal stub suffices):"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import { createReleasePullRequest, resolveReleaseTagPlan } from '@repo-toolkit/release-tag';\n\nconst seen: string[] = [];\nconst fetchFn = (async (url: unknown) => {\n  seen.push(String(url));\n  return {\n    ok: true,\n    status: 201,\n    text: async () => JSON.stringify({ number: 7, html_url: 'https://github.com/octo/hello/pull/7' }),\n  };\n}) as unknown as typeof fetch;\n\nconst plan = resolveReleaseTagPlan({ githubRepository: 'octo/hello' });\nconst result = await createReleasePullRequest({\n  plan,\n  determined: { version: '1.2.3', tagVersion: 'v1.2.3', bump: 'minor', lastTag: 'v1.2.2', manual: false },\n  release: {\n    baseBranch: 'main',\n    releaseBranch: 'changelog/1.2.3',\n    releaseRan: true,\n    skippedReason: null,\n    tagMessage: 'Release 1.2.3 notes',\n    prTitle: 'chore(release): release candidate v1.2.3',\n  },\n  githubToken: 'fake-token-for-tests',\n  fetchFn,\n});\nexpect(result).toMatchObject({ skipped: false, number: 7 });\nexpect(seen[0]).toContain('/repos/octo/hello/pulls');\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Stage 2 follows the same queue pattern with one canned result per git invocation plus a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "run"
      }), " handler for the release command; see ", (0,jsx_runtime.jsx)(_components.code, {
        children: "test/release.test.ts"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "test/run.test.ts"
      }), " in the package for full scripted coverage, including merge/delete flows."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "github-actions-workflow",
      children: "GitHub Actions workflow"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-yaml",
        children: "name: Release\n\non:\n  workflow_dispatch:\n\njobs:\n  release:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n      pull-requests: write\n      issues: write\n\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n          fetch-tags: true\n\n      - run: pnpm install --frozen-lockfile\n\n      - run: pnpm release-tag -- --base-branch main --github-repository ${{ github.repository }}\n        env:\n          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Add ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--auto-merge-pr --delete-merged-branch"
      }), " to merge the release PR immediately. The checkout needs full history and tags so stage 1 can read ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git describe"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "git log"
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
      }), ", so no git reads occur. This differs from the library split: ", (0,jsx_runtime.jsx)(_components.code, {
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
        }), " values are rejected."]
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
          children: "release command not available: <cmd>."
        }), " Install or correct ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--release-command"
        }), "; the branch is still created and pushed."]
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
        }), " The file must contain non-whitespace; empty files throw without env fallback."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "preflight failed: GitHub token check ..."
        }), " Either the token is invalid (non-2xx, including permission-404s) or it lacks push permission. Grant Contents, Pull requests, and Issues read/write on the repo as listed in ", (0,jsx_runtime.jsx)(_components.a, {
          href: "#prerequisites",
          children: "Prerequisites"
        }), ", verify with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "GH_TOKEN=$(cat ./token.txt) gh api repos/owner/repo --jq .permissions"
        }), ", then retry. Nothing was mutated."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "GitHub API response ... exceeding the ...-byte response limit."
        }), " Lower history or raise ", (0,jsx_runtime.jsx)(_components.code, {
          children: "maxOutputBytes"
        }), "; the PR cap is ", (0,jsx_runtime.jsx)(_components.code, {
          children: "min(maxOutputBytes, 1MiB)"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Merge ", (0,jsx_runtime.jsx)(_components.code, {
          children: "405"
        }), "/", (0,jsx_runtime.jsx)(_components.code, {
          children: "422"
        }), ". Branch protection or a non-mergeable state; the stage fails without deleting the branch."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Stuck at release-it ", (0,jsx_runtime.jsx)(_components.code, {
          children: "Git push"
        }), " (only possible with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--skip-preflight"
        }), ", since the preflight catches missing non-interactive auth). The spinner hides an SSH passphrase prompt: type the passphrase blind and press Enter, or kill the run. Assess with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git status --short --branch"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git log --oneline -3"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git tag -l"
        }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git ls-remote origin"
        }), "; the release commit exists locally only. Either resume manually (", (0,jsx_runtime.jsx)(_components.code, {
          children: "git push --follow-tags origin changelog/<version>"
        }), ", then create the PR) or retry cleanly: ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git checkout main"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "git tag -d v<version>"
        }), ", load ssh-agent, and re-run."]
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
          children: "gh api repos/owner/repo/issues/<n>/labels"
        }), ", which auto-creates missing labels exactly like the tool's own REST call."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.h2, {
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
      children: ["Behavioral deltas are intentional: manual tags strip one leading ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v"
      }), " instead of every ", (0,jsx_runtime.jsx)(_components.code, {
        children: "v"
      }), "; ", (0,jsx_runtime.jsx)(_components.code, {
        children: "signCommit"
      }), " never imports GPG keys; ", (0,jsx_runtime.jsx)(_components.code, {
        children: "githubApiUrl"
      }), " plus ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GITHUB_API_URL"
      }), " support GitHub Enterprise REST without ", (0,jsx_runtime.jsx)(_components.code, {
        children: "gh"
      }), "; and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--only"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--dry-run"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--json"
      }), " have no action equivalent. The PR title, body template, label set, branch naming, and bump regexes otherwise match the action."]
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