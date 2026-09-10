"use strict";
(globalThis["webpackChunkwebsite"] = globalThis["webpackChunkwebsite"] || []).push([[225],{

/***/ 1537
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  assets: () => (/* binding */ assets),
  contentTitle: () => (/* binding */ contentTitle),
  "default": () => (/* binding */ MDXContent),
  frontMatter: () => (/* binding */ frontMatter),
  metadata: () => (/* reexport */ site_docs_packages_docker_publish_md_8c4_namespaceObject),
  toc: () => (/* binding */ toc)
});

;// ./.docusaurus/docusaurus-plugin-content-docs/default/site-docs-packages-docker-publish-md-8c4.json
const site_docs_packages_docker_publish_md_8c4_namespaceObject = /*#__PURE__*/JSON.parse('{"id":"packages/docker-publish","title":"@repo-toolkit/docker-publish","description":"@repo-toolkit/docker-publish plans, builds, publishes, and verifies Docker/OCI container images to target registries.","source":"@site/docs/packages/docker-publish.md","sourceDirName":"packages","slug":"/packages/docker-publish","permalink":"/docs/packages/docker-publish","draft":false,"unlisted":false,"tags":[],"version":"current","sidebarPosition":7,"frontMatter":{"sidebar_label":"Docker Publish","sidebar_position":7},"sidebar":"packagesSidebar","previous":{"title":"Compose Sandbox","permalink":"/docs/packages/compose-sandbox"}}');
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(1325);
// EXTERNAL MODULE: ./node_modules/.pnpm/@mdx-js+react@3.1.1_@types+react@19.2.14_react@19.2.6/node_modules/@mdx-js/react/lib/index.js
var lib = __webpack_require__(1982);
;// ./docs/packages/docker-publish.md


const frontMatter = {
	sidebar_label: 'Docker Publish',
	sidebar_position: 7
};
const contentTitle = '@repo-toolkit/docker-publish';

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
  "value": "Tested Configurations",
  "id": "tested-configurations",
  "level": 2
}, {
  "value": "Single Image",
  "id": "single-image",
  "level": 3
}, {
  "value": "Multiple Images And Registries",
  "id": "multiple-images-and-registries",
  "level": 3
}, {
  "value": "Configuration Reference",
  "id": "configuration-reference",
  "level": 2
}, {
  "value": "Config Precedence And CLI Overrides",
  "id": "config-precedence-and-cli-overrides",
  "level": 2
}, {
  "value": "CLI",
  "id": "cli",
  "level": 2
}, {
  "value": "Interactive Mode",
  "id": "interactive-mode",
  "level": 2
}, {
  "value": "Tag And Reference Contract",
  "id": "tag-and-reference-contract",
  "level": 2
}, {
  "value": "Digest Format",
  "id": "digest-format",
  "level": 2
}, {
  "value": "Push Boundaries",
  "id": "push-boundaries",
  "level": 2
}, {
  "value": "Process Limits",
  "id": "process-limits",
  "level": 2
}, {
  "value": "Registry Auth Contract",
  "id": "registry-auth-contract",
  "level": 2
}, {
  "value": "Allowlist Semantics",
  "id": "allowlist-semantics",
  "level": 2
}, {
  "value": "Platform Support",
  "id": "platform-support",
  "level": 2
}, {
  "value": "Latest Policy",
  "id": "latest-policy",
  "level": 2
}, {
  "value": "Load-Versus-Push Separation",
  "id": "load-versus-push-separation",
  "level": 2
}, {
  "value": "Context Trust",
  "id": "context-trust",
  "level": 2
}, {
  "value": "Digest Manifests",
  "id": "digest-manifests",
  "level": 2
}, {
  "value": "Makefile And CI",
  "id": "makefile-and-ci",
  "level": 2
}, {
  "value": "Migration Caveats",
  "id": "migration-caveats",
  "level": 2
}, {
  "value": "Library API",
  "id": "library-api",
  "level": 2
}, {
  "value": "What This Package Does Not Do",
  "id": "what-this-package-does-not-do",
  "level": 2
}];
function _createMdxContent(props) {
  const _components = {
    code: "code",
    em: "em",
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
        id: "repo-toolkitdocker-publish",
        children: (0,jsx_runtime.jsx)(_components.code, {
          children: "@repo-toolkit/docker-publish"
        })
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "@repo-toolkit/docker-publish"
      }), " plans, builds, publishes, and verifies Docker/OCI container images to target registries."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["One validated configuration model supports single-image and multi-image repositories. Each image is built for an explicit platform matrix, tagged deterministically, pushed only to allowlisted registries, pinned by content digest, and verified against the published manifest. Builds never implicitly publish: the build path uses ", (0,jsx_runtime.jsx)(_components.code, {
        children: "docker buildx build"
      }), " without ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--push"
      }), ", and publishing is an explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "docker push"
      }), " step with digest capture."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "requirements",
      children: "Requirements"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "Node.js 20 or newer."
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["A Docker executable with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "buildx"
        }), " support for build, publish, and verify operations. Check with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "docker buildx version"
        }), "."]
      }), "\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "A filesystem where temporary files can be renamed within the output directory (digest manifests are written atomically via a sibling temp file plus rename)."
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "The package does not install Docker, provision BuildKit builders, administer registries, scan images for CVEs, or generate SBOMs, signatures, attestations, or provenance payloads. Downstream workflows may consume the digests this package returns."
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "install",
      children: "Install"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "pnpm add -D @repo-toolkit/docker-publish\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "tested-configurations",
      children: "Tested Configurations"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The JSON examples below are compared as parsed objects with fixtures in the package test suite (", (0,jsx_runtime.jsx)(_components.code, {
        children: "test/examples.test.ts"
      }), "), then resolved, dry-run through the build CLI, built, published, and verified with injected fake runners — no daemon or network access required."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "single-image",
      children: "Single Image"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "One image pushed to one registry for two platforms under a single version tag. This is the smallest layout that exercises the full plan, build, publish, and verify pipeline."
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-json",
        children: "{\n  \"images\": [\n    {\n      \"name\": \"app\",\n      \"contextDir\": \"services/app\"\n    }\n  ],\n  \"registries\": [\n    {\n      \"hostname\": \"registry.example.com\",\n      \"repositoryPrefix\": \"team\"\n    }\n  ],\n  \"tags\": [\"1.2.3\"],\n  \"platforms\": [\"linux/amd64\", \"linux/arm64\"]\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The plan resolves one reference, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "registry.example.com/team/app:1.2.3"
      }), ", built for ", (0,jsx_runtime.jsx)(_components.code, {
        children: "linux/amd64"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "linux/arm64"
      }), ". Because the build is multi-platform, no ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--load"
      }), " flag is passed and no local image ID verification runs; the digest is captured at publish time instead."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "multiple-images-and-registries",
      children: "Multiple Images And Registries"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Two images pushed to two registries with distinct tags, build arguments, and labels. Each image inherits the global matrix and may add its own ", (0,jsx_runtime.jsx)(_components.code, {
        children: "buildArgs"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "labels"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-json",
        children: "{\n  \"images\": [\n    {\n      \"name\": \"app\",\n      \"contextDir\": \"services/app\"\n    },\n    {\n      \"name\": \"worker\",\n      \"contextDir\": \"services/worker\",\n      \"buildArgs\": {\n        \"WORKER_CONCURRENCY\": \"4\"\n      },\n      \"labels\": {\n        \"org.opencontainers.image.title\": \"worker\"\n      }\n    }\n  ],\n  \"registries\": [\n    {\n      \"hostname\": \"registry.example.com\",\n      \"repositoryPrefix\": \"team\"\n    },\n    {\n      \"hostname\": \"localhost:5000\"\n    }\n  ],\n  \"tags\": [\"1.2.3\", \"latest\"],\n  \"platforms\": [\"linux/amd64\", \"linux/arm64\"],\n  \"buildConcurrency\": 2\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The plan resolves eight references: two images × two registries × two tags. A registry without ", (0,jsx_runtime.jsx)(_components.code, {
        children: "repositoryPrefix"
      }), " produces references such as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "localhost:5000/worker:1.2.3"
      }), ". Per-image ", (0,jsx_runtime.jsx)(_components.code, {
        children: "buildArgs"
      }), " merge over global ", (0,jsx_runtime.jsx)(_components.code, {
        children: "buildArgs"
      }), "; per-image ", (0,jsx_runtime.jsx)(_components.code, {
        children: "labels"
      }), " merge over global ", (0,jsx_runtime.jsx)(_components.code, {
        children: "labels"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "configuration-reference",
      children: "Configuration Reference"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Configuration is a JSON, ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".mjs"
      }), ", or ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".cjs"
      }), " (default export) file loaded with the shared ", (0,jsx_runtime.jsx)(_components.code, {
        children: "loadConfigFile"
      }), " helper. Unknown keys fail validation at every level (options, image, registry, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "processLimits"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "verification"
      }), ")."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "Option"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Type"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Default"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Notes"
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "cwd"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "string"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "current working directory"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Project root. Resolved to its real path; every context, Dockerfile, and manifest path must stay inside it."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "images"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "array"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "required, at least one"
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Each entry: ", (0,jsx_runtime.jsx)(_components.code, {
              children: "name"
            }), ", ", (0,jsx_runtime.jsx)(_components.code, {
              children: "contextDir"
            }), ", optional ", (0,jsx_runtime.jsx)(_components.code, {
              children: "dockerfile"
            }), " (defaults to ", (0,jsx_runtime.jsx)(_components.code, {
              children: "<contextDir>/Dockerfile"
            }), "), optional ", (0,jsx_runtime.jsx)(_components.code, {
              children: "target"
            }), " build stage, optional per-image ", (0,jsx_runtime.jsx)(_components.code, {
              children: "buildArgs"
            }), "/", (0,jsx_runtime.jsx)(_components.code, {
              children: "labels"
            }), ". Names must be unique."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "registries"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "array"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "required, at least one"
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Each entry: ", (0,jsx_runtime.jsx)(_components.code, {
              children: "hostname"
            }), ", optional ", (0,jsx_runtime.jsx)(_components.code, {
              children: "repositoryPrefix"
            }), " (defaults to ", (0,jsx_runtime.jsx)(_components.code, {
              children: "\"\""
            }), "). Hostnames are lowercase with no scheme, path, userinfo, or port abuse. No implicit Docker Hub default."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "tags"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "string array"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "required, at least one"
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Docker tag rules: lowercase, ", (0,jsx_runtime.jsx)(_components.code, {
              children: "[a-z0-9_][a-z0-9_.-]{0,127}"
            }), ", max 128 characters. No duplicates."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "platforms"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "string array"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "required, at least one"
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Explicit ", (0,jsx_runtime.jsx)(_components.code, {
              children: "os/arch[/variant]"
            }), " list. A known-OS/arch table covers the common pairs; anything else requires ", (0,jsx_runtime.jsx)(_components.code, {
              children: "allowCustomPlatforms: true"
            }), "."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "buildArgs"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "string map"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "{}"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Passed as separate ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--build-arg KEY=VALUE"
            }), " argv entries. Max 64 entries, 128-char keys, 4096-char values; no whitespace or control characters in keys. Keys containing ", (0,jsx_runtime.jsx)(_components.code, {
              children: "TOKEN"
            }), ", ", (0,jsx_runtime.jsx)(_components.code, {
              children: "SECRET"
            }), ", or ", (0,jsx_runtime.jsx)(_components.code, {
              children: "PASSWORD"
            }), " are rejected unless ", (0,jsx_runtime.jsx)(_components.code, {
              children: "allowSecretsInBuildArgs: true"
            }), "."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "labels"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "string map"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "{}"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Passed as separate ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--label KEY=VALUE"
            }), " argv entries. Same bounds and secret-key guard as ", (0,jsx_runtime.jsx)(_components.code, {
              children: "buildArgs"
            }), "."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "buildConcurrency"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "number"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "2"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Max concurrent image builds. Positive safe integer, max 64."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "publishConcurrency"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "number"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "1"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Max concurrent pushes. Serial by default to avoid registry rate limits. Positive safe integer, max 64. Library-only for ", (0,jsx_runtime.jsx)(_components.code, {
              children: "publishDockerImages"
            }), "; the CLIs also accept ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--publish-concurrency"
            }), "."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "processLimits"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "object"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "{ timeoutMs: 600000, maxOutputBytes: 1048576 }"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Timeout and captured-output cap applied at the runner boundary to every Docker invocation."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "dockerExecutable"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "string"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "\"docker\""
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Docker binary name or path used for every invocation."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "allowSecretsInBuildArgs"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "boolean"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Opt in to secret-looking ", (0,jsx_runtime.jsx)(_components.code, {
              children: "buildArgs"
            }), "/", (0,jsx_runtime.jsx)(_components.code, {
              children: "labels"
            }), " keys. Prefer build secrets or runtime env over baking credentials into layers."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "allowCustomPlatforms"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "boolean"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Opt in to ", (0,jsx_runtime.jsx)(_components.code, {
              children: "os/arch"
            }), " pairs outside the known table."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "verification"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "object"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "{ enabled: true, requireDigestMatch: true }"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Plan-level verification policy consumed by ", (0,jsx_runtime.jsx)(_components.code, {
              children: "verifyDockerPublish"
            }), ". ", (0,jsx_runtime.jsx)(_components.code, {
              children: "enabled: false"
            }), " makes verification refuse to run instead of reporting unverified results; ", (0,jsx_runtime.jsx)(_components.code, {
              children: "requireDigestMatch: false"
            }), " still reports per-reference ", (0,jsx_runtime.jsx)(_components.code, {
              children: "match"
            }), " flags without failing on digest mismatch."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "auth"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "map"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "{}"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Registry auth env contract (see below). Passed through by the CLIs; only ", (0,jsx_runtime.jsx)(_components.code, {
              children: "runner"
            }), " is rejected as a CLI config key because custom runners are available solely to library callers."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "digestManifestPath"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "string"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "unset"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Caller-owned relative path for the sorted JSON digest manifest. Must stay inside the project root."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "expectedDigests"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "map"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "unset"
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Reference-to-digest map consumed by ", (0,jsx_runtime.jsx)(_components.code, {
              children: "verifyDockerPublish"
            }), " and the unified CLI ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--verify"
            }), "-without-", (0,jsx_runtime.jsx)(_components.code, {
              children: "--push"
            }), " path."]
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "config-precedence-and-cli-overrides",
      children: "Config Precedence And CLI Overrides"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Configuration supplies defaults and explicit CLI flags override them:"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "--cwd"
        }), " overrides ", (0,jsx_runtime.jsx)(_components.code, {
          children: "cwd"
        }), "; ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--docker-executable"
        }), " overrides ", (0,jsx_runtime.jsx)(_components.code, {
          children: "dockerExecutable"
        }), "; ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--concurrency"
        }), " overrides ", (0,jsx_runtime.jsx)(_components.code, {
          children: "buildConcurrency"
        }), "; ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--publish-concurrency"
        }), " overrides ", (0,jsx_runtime.jsx)(_components.code, {
          children: "publishConcurrency"
        }), "; ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--digest-manifest"
        }), " overrides ", (0,jsx_runtime.jsx)(_components.code, {
          children: "digestManifestPath"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "--image"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--platform"
        }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--registry"
        }), " are repeatable (comma-split) filters that narrow the resolved plan to named entries. Unknown or duplicate filter values fail before any Docker process runs."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["The publish and unified CLIs pass ", (0,jsx_runtime.jsx)(_components.code, {
          children: "auth"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "digestManifestPath"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "publishConcurrency"
        }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "expectedDigests"
        }), " through without revalidating them as plan keys."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["A ", (0,jsx_runtime.jsx)(_components.code, {
          children: "runner"
        }), " key in CLI configuration is rejected: custom runners are available only to library callers."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "cli",
      children: "CLI"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["All CLIs use explicit flags; there are no positional subcommands. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "parseFlags"
      }), " runs in strict mode: unknown flags and missing values fail, and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "-h"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "--help"
      }), " prints help."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-build-docker-publish --config docker-publish.json --dry-run\nrepo-toolkit-build-docker-publish --config docker-publish.json --image app --platform linux/amd64\nrepo-toolkit-publish-docker-publish --config docker-publish.json --skip-build --digest-manifest digests.json --verify\nrepo-toolkit-docker-publish --config docker-publish.json --build --push\nrepo-toolkit-docker-publish --config docker-publish.json --push --verify\nrepo-toolkit-docker-publish --config docker-publish.json --verify\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["The build CLI builds every planned image and prints image IDs (single-platform ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--load"
        }), " builds), references, platforms, and durations."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["The publish CLI builds first unless ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--skip-build"
        }), " is given (publish prebuilt local images), pushes only planned references, optionally writes the digest manifest, and optionally verifies with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--verify"
        }), " using the just-published digests."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["The unified CLI dispatches via ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--build"
        }), "/", (0,jsx_runtime.jsx)(_components.code, {
          children: "--push"
        }), "/", (0,jsx_runtime.jsx)(_components.code, {
          children: "--verify"
        }), ". Without an operation flag it runs build followed by push. ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--verify"
        }), " after a push reuses the returned digests; ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--verify"
        }), " without ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--push"
        }), " uses ", (0,jsx_runtime.jsx)(_components.code, {
          children: "expectedDigests"
        }), " from configuration."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "--dry-run"
        }), " resolves and prints the full plan (images, references, platforms) without invoking Docker and without requiring daemon access. Invalid configuration fails before any runner call."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Summaries are deterministic JSON and secrets-free: they contain references, digests, durations, and concurrency, never build-arg values, environments, runner objects, or executable paths beyond the configured Docker binary name."
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "interactive-mode",
      children: "Interactive Mode"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["All three CLIs accept ", (0,jsx_runtime.jsx)(_components.code, {
        children: "-i"
      }), " / ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--interactive"
      }), " to prompt for required values on a TTY instead of requiring a config file up front:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-build-docker-publish --interactive\nrepo-toolkit-publish-docker-publish --config docker-publish.json --interactive\nrepo-toolkit-docker-publish --interactive --build --push\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The staged flow is: config-file path (offered only when ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--config"
      }), " is absent; empty input configures without a file), essentials (image entries, registry entries, tags, platforms, each looped with an add-another confirm where applicable), then an advanced group (build args, labels, concurrencies, process limits, Docker executable) behind a customize confirm that defaults to No. Registry hostnames are chosen from a common-registry list (Docker Hub, GHCR, GitLab, GCR, Quay.io, local ", (0,jsx_runtime.jsx)(_components.code, {
        children: "localhost:5000"
      }), ") with a custom-hostname entry last; the configured hostname preselects the matching entry, or the custom entry when it is not listed. Every prompt defaults to the loaded config value when one exists, so accepting all defaults reproduces the equivalent config file."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Precedence is CLI flag > prompt answer > config default: explicit flags such as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--cwd"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--docker-executable"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--concurrency"
      }), ", and the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--image"
      }), " / ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--platform"
      }), " / ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--registry"
      }), " filters always win over prompted and configured values."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["TTY rule: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "-i"
      }), " without a TTY fails closed before any prompt or Docker invocation with an error telling the user to pass ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--config"
      }), " or run in a TTY. CI never hangs on stdin."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Auth is ephemeral-only: per registry the CLI prompts the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "usernameEnv"
      }), " / ", (0,jsx_runtime.jsx)(_components.code, {
        children: "passwordEnv"
      }), " names, then — when the named password variable is set and non-empty — offers a choice between using the environment value (default, recommended) and entering a new masked password; otherwise it goes straight to masked entry. Entered passwords live in memory for this run's ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--password-stdin"
      }), " login only. Nothing is written to disk, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "process.env"
      }), " is never mutated, and typed secrets appear in no summary, config output, log, or error (they are covered by the shared redaction helper)."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Confirm gate: after plan resolution the CLI prints the standard secrets-free summary and asks ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Proceed?"
      }), " — defaulting to Yes for build-only runs and requiring an explicit Yes before any push. Declining or cancelling aborts with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Operation cancelled."
      }), " before any Docker invocation. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--dry-run"
      }), " prints the plan and returns before auth prompts and before the confirm (planning prompts still apply so dry-run can shape the plan). There is no save feature: answers are never persisted."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "tag-and-reference-contract",
      children: "Tag And Reference Contract"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Exactly one helper formats references — ", (0,jsx_runtime.jsx)(_components.code, {
        children: "formatImageReference(registry, repository, name, tag)"
      }), " — and no caller concatenates references by hand:"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["With a repository prefix: ", (0,jsx_runtime.jsx)(_components.code, {
          children: "registry.example.com/team/app:1.2.3"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Without one: ", (0,jsx_runtime.jsx)(_components.code, {
          children: "localhost:5000/worker:1.2.3"
        }), "."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Any ", (0,jsx_runtime.jsx)(_components.code, {
          children: "{"
        }), "/", (0,jsx_runtime.jsx)(_components.code, {
          children: "}"
        }), " in a part is rejected; there are no template tokens and no shell or code evaluation."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Tags are caller-owned: the package derives nothing from Git, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "VERSION"
      }), " files, or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "package.json"
      }), ". ", (0,jsx_runtime.jsx)(_components.code, {
        children: "latest"
      }), " has no special status — it is pushed only when listed in ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tags"
      }), ", and omitted otherwise. Duplicate fully-qualified references across images, registries, or tags fail during planning."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "digest-format",
      children: "Digest Format"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Digests are lowercase ", (0,jsx_runtime.jsx)(_components.code, {
        children: "sha256:<64-hex>"
      }), " strings. On push, the digest is parsed from ", (0,jsx_runtime.jsx)(_components.code, {
        children: "docker push"
      }), " output (", (0,jsx_runtime.jsx)(_components.code, {
        children: "digest: sha256:..."
      }), ") and cross-checked against a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "docker buildx imagetools inspect --format {{json .Manifest}}"
      }), " follow-up: when both are present they must agree, the inspect digest is the fallback when push output carries none, and absence of both fails closed. Malformed or ambiguous digests fail closed."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "push-boundaries",
      children: "Push Boundaries"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "Only references produced by the resolved plan are pushed. Off-plan, duplicate, or unlisted-registry references fail before any runner call, even if the daemon holds them locally."
      }), "\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "The registry allowlist is enforced at publish time even when the plan was constructed programmatically (defense in depth)."
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Pushes run through a worker pool bounded by ", (0,jsx_runtime.jsx)(_components.code, {
          children: "publishConcurrency"
        }), " (default serial). The first failure stops new pushes from starting while already-started pushes are awaited."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "dryRun: true"
        }), " (library) returns an empty publish list after plan validation with zero runner calls, zero credential reads, and zero manifest writes."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "process-limits",
      children: "Process Limits"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Every Docker invocation runs as a structured argv array through the injected runner — never a shell string — bounded by ", (0,jsx_runtime.jsx)(_components.code, {
        children: "processLimits.timeoutMs"
      }), " (default 600000ms) and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "processLimits.maxOutputBytes"
      }), " (default 1048576 bytes). Timed-out and output-overflow processes are terminated (", (0,jsx_runtime.jsx)(_components.code, {
        children: "SIGKILL"
      }), " by default) with errors that identify the executable without exposing secret values. Daemon output tails in errors are truncated to 2048 characters. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "capture"
      }), " records wall-clock duration and truncated output size without retaining unbounded buffers."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "registry-auth-contract",
      children: "Registry Auth Contract"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Credentials are sourced from environment variables named by the config ", (0,jsx_runtime.jsx)(_components.code, {
        children: "auth"
      }), " map and travel to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "docker login"
      }), " via ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--password-stdin"
      }), " only:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-json",
        children: "{\n  \"auth\": {\n    \"registry.example.com\": {\n      \"usernameEnv\": \"REGISTRY_EXAMPLE_COM_USER\",\n      \"passwordEnv\": \"REGISTRY_EXAMPLE_COM_PASS\"\n    }\n  }\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "export REGISTRY_EXAMPLE_COM_USER=\"example-user\"\nexport REGISTRY_EXAMPLE_COM_PASS=\"example-pass\"\nrepo-toolkit-publish-docker-publish --config docker-publish.json\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Env names must match ", (0,jsx_runtime.jsx)(_components.code, {
          children: "/^[A-Za-z_][A-Za-z0-9_]*$/"
        }), ". Missing or empty env credentials fail closed before any push."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Plaintext passwords never appear in config files, argv (there is no ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--password"
        }), " flag path), logs, summaries, or error messages. Secrets are redacted from tails via the shared redaction helper, including ", (0,jsx_runtime.jsx)(_components.code, {
          children: "://user:pass@"
        }), " URLs."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Logins run once per needed registry up front as ", (0,jsx_runtime.jsx)(_components.code, {
          children: "docker login --username <user> --password-stdin <hostname>"
        }), " with the password on stdin."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["A registry without an ", (0,jsx_runtime.jsx)(_components.code, {
          children: "auth"
        }), " entry is pushed without a login step (public or pre-authenticated registries)."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "allowlist-semantics",
      children: "Allowlist Semantics"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "registries"
      }), " is the push allowlist: every pushed reference's hostname must match a configured registry exactly, checked both at plan resolution and again at the publish boundary. There is no wildcard, no suffix match, and no implicit Docker Hub fallback — an unconfigured hostname fails closed with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Refusing to push to unlisted registry"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "platform-support",
      children: "Platform Support"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Platforms are explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "os/arch[/variant]"
      }), " tokens validated against a known-OS table (", (0,jsx_runtime.jsx)(_components.code, {
        children: "linux"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "darwin"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "windows"
      }), ", and others) and known-arch table (", (0,jsx_runtime.jsx)(_components.code, {
        children: "amd64"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "arm64"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "386"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "arm"
      }), ", and others). Unknown pairs require ", (0,jsx_runtime.jsx)(_components.code, {
        children: "allowCustomPlatforms: true"
      }), ". Verification requires the published manifest's platform set to equal the planned set exactly: missing platforms and unexpected platforms both fail."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "latest-policy",
      children: "Latest Policy"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "latest"
      }), " is an ordinary tag. Include it in ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tags"
      }), " to publish and verify a floating reference alongside pinned version tags; omit it to keep every published reference immutable. The package never adds ", (0,jsx_runtime.jsx)(_components.code, {
        children: "latest"
      }), " on its own."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "load-versus-push-separation",
      children: "Load-Versus-Push Separation"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Build runs ", (0,jsx_runtime.jsx)(_components.code, {
          children: "docker buildx build --platform <join> -f <Dockerfile> [-t <reference>...] [--build-arg ...] [--label ...]"
        }), " plus ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--load"
        }), " for single-platform images only. The build path never contains ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--push"
        }), " (asserted by tests at both the argv and module-source level)."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Single-platform ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--load"
        }), " builds are verified with ", (0,jsx_runtime.jsx)(_components.code, {
          children: "docker images --no-trunc --format ..."
        }), ": empty, missing, unexpected, or conflicting entries fail closed. On failure the operation best-effort untags (", (0,jsx_runtime.jsx)(_components.code, {
          children: "docker rmi"
        }), ") what it created and reports image identity, platform set, and the output tail."]
      }), "\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "Multi-platform builds produce no local image; their digests are captured at publish time."
      }), "\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "No build output files are written to the repository; only the Docker daemon receives image data."
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "context-trust",
      children: "Context Trust"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Build contexts are trusted, immutable snapshots."
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Plan resolution pins each context root and Dockerfile through lexical containment plus ", (0,jsx_runtime.jsx)(_components.code, {
        children: "lstat"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "realpath"
      }), " checks (the Dockerfile must resolve inside its context), but symlinks ", (0,jsx_runtime.jsx)(_components.em, {
        children: "inside"
      }), " the context tree are never enumerated and Docker follows them at build time. Scanning every tree on every build would stay racy (the tree can change after the scan) while adding I/O to a hot path, so the package instead treats contexts as trusted input: keep them immutable between plan and build and never include untrusted symlinks or files. As a backstop against swaps of the pinned paths themselves, the build step re-validates the resolved context directory and Dockerfile immediately before spawning Docker and fails closed when either changed, vanished, or no longer resolves to the planned real path."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "digest-manifests",
      children: "Digest Manifests"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["When ", (0,jsx_runtime.jsx)(_components.code, {
        children: "digestManifestPath"
      }), " (or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--digest-manifest"
      }), ") is set, publish writes a pretty-printed JSON map of reference to digest, sorted by reference with a trailing newline, atomically (temp sibling plus rename) inside the project root:"]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-json",
        children: "{\n  \"registry.example.com/team/app:1.2.3\": \"sha256:<64-hex>\"\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Manifest write failures carry the underlying cause. Verification consumes the same shape through ", (0,jsx_runtime.jsx)(_components.code, {
        children: "expectedDigests"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "makefile-and-ci",
      children: "Makefile And CI"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Thin targets that consume the CLIs. The package creates no tags, SBOMs, provenance, image registries, or GitHub Releases — release tagging and artifact upload stay in the release workflow."
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-make",
        children: "DOCKER_PUBLISH_CONFIG ?= docker-publish.json\n\n.PHONY: docker-plan docker-build docker-publish\n\ndocker-plan:\n\tpnpm docker-publish -- --config $(DOCKER_PUBLISH_CONFIG) --build --push --dry-run\n\ndocker-build:\n\tpnpm build-docker-publish -- --config $(DOCKER_PUBLISH_CONFIG)\n\ndocker-publish:\n\tpnpm publish-docker-publish -- --config $(DOCKER_PUBLISH_CONFIG) --digest-manifest digests.json --verify\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Standalone ", (0,jsx_runtime.jsx)(_components.code, {
        children: "pnpm docker-publish -- --config $(DOCKER_PUBLISH_CONFIG) --verify"
      }), " verifies without pushing and reads ", (0,jsx_runtime.jsx)(_components.code, {
        children: "expectedDigests"
      }), " from configuration."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-yaml",
        children: "# Consume the CLI from CI without claiming package-owned provenance.\n# Registry credentials travel via environment; nothing secret is passed as argv.\nsteps:\n  - uses: pnpm/action-setup@v4\n  - run: pnpm install --frozen-lockfile\n  - run: pnpm build-docker-publish -- --config docker-publish.json --dry-run\n  - run: pnpm publish-docker-publish -- --config docker-publish.json --digest-manifest digests.json\n    env:\n      REGISTRY_EXAMPLE_COM_USER: ${{ secrets.REGISTRY_USER }}\n      REGISTRY_EXAMPLE_COM_PASS: ${{ secrets.REGISTRY_PASS }}\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "migration-caveats",
      children: "Migration Caveats"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.strong, {
          children: "Tag naming:"
        }), " tags must already satisfy Docker rules at plan time. Retagging an existing ad-hoc scheme means editing ", (0,jsx_runtime.jsx)(_components.code, {
          children: "tags"
        }), ", not flags — there is no tag-rewrite option."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsxs)(_components.strong, {
          children: [(0,jsx_runtime.jsx)(_components.code, {
            children: "latest"
          }), " policy:"]
        }), " if a previous workflow pushed ", (0,jsx_runtime.jsx)(_components.code, {
          children: "latest"
        }), " implicitly, add it to ", (0,jsx_runtime.jsx)(_components.code, {
          children: "tags"
        }), " explicitly or previously floating consumers will stop receiving updates."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.strong, {
          children: "Load-versus-push separation:"
        }), " scripts that relied on ", (0,jsx_runtime.jsx)(_components.code, {
          children: "docker build"
        }), " pushing (or on a local image existing after a multi-platform build) must call the publish CLI explicitly; multi-platform builds intentionally leave no local image."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.strong, {
          children: "Managed digest manifests:"
        }), " treat ", (0,jsx_runtime.jsx)(_components.code, {
          children: "digests.json"
        }), " as a build output — commit it only if downstream pinning needs a checked-in record, and regenerate it on every publish rather than hand-editing digests."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "library-api",
      children: "Library API"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import {\n  buildDockerImages,\n  publishDockerImages,\n  resolveDockerPublishPlan,\n  verifyDockerPublish,\n} from '@repo-toolkit/docker-publish';\n\nconst options = {\n  cwd: 'my-app',\n  images: [{ name: 'app', contextDir: 'services/app' }],\n  registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],\n  tags: ['1.2.3'],\n  platforms: ['linux/amd64', 'linux/arm64'],\n};\n\nconst plan = resolveDockerPublishPlan(options);\nconst built = await buildDockerImages(options);\nconst published = await publishDockerImages({ ...options, digestManifestPath: 'digests.json' });\nconst expectedDigests = Object.fromEntries(published.publishes.map((entry) => [entry.reference, entry.digest]));\nconst verified = await verifyDockerPublish({ ...options, expectedDigests });\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Library callers pass full option objects; ", (0,jsx_runtime.jsx)(_components.code, {
        children: "buildDockerImages"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "publishDockerImages"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "verifyDockerPublish"
      }), " each accept an injectable ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runner"
      }), " (", (0,jsx_runtime.jsx)(_components.code, {
        children: "run"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "capture"
      }), ") so tests can substitute fake runners with zero daemon or network access. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "publishDockerImages"
      }), " additionally accepts ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runner"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "dryRun"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "publishConcurrency"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "references"
      }), " (a subset of the plan, still allowlisted), ", (0,jsx_runtime.jsx)(_components.code, {
        children: "auth"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "digestManifestPath"
      }), ". ", (0,jsx_runtime.jsx)(_components.code, {
        children: "verifyDockerPublish"
      }), " accepts ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runner"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "references"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "expectedDigests"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "maxManifestBytes"
      }), ", and rejects ", (0,jsx_runtime.jsx)(_components.code, {
        children: "pull: true"
      }), " — verification is manifest-only inspection and never pulls layers."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "what-this-package-does-not-do",
      children: "What This Package Does Not Do"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Creating or pushing Git tags or GitHub Releases, generating SBOMs, signatures, attestations, or provenance payloads, running Compose stacks or deployments, provisioning daemons or builders, administering registries, scanning for CVEs, installing asdf plugins, or centralizing release-tag, SHA, ", (0,jsx_runtime.jsx)(_components.code, {
        children: "VERSION"
      }), ", or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "package.json"
      }), " consistency. Those stay explicitly deferred."]
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