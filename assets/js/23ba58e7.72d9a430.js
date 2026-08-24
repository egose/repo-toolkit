"use strict";
(globalThis["webpackChunkwebsite"] = globalThis["webpackChunkwebsite"] || []).push([[870],{

/***/ 9648
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  assets: () => (/* binding */ assets),
  contentTitle: () => (/* binding */ contentTitle),
  "default": () => (/* binding */ MDXContent),
  frontMatter: () => (/* binding */ frontMatter),
  metadata: () => (/* reexport */ site_docs_packages_go_release_md_23b_namespaceObject),
  toc: () => (/* binding */ toc)
});

;// ./.docusaurus/docusaurus-plugin-content-docs/default/site-docs-packages-go-release-md-23b.json
const site_docs_packages_go_release_md_23b_namespaceObject = /*#__PURE__*/JSON.parse('{"id":"packages/go-release","title":"@repo-toolkit/go-release","description":"@repo-toolkit/go-release builds an explicit GOOS/GOARCH matrix, creates deterministic tar.gz files, writes SHA-256 checksums, and verifies release output before publication. It supports the single-binary shape used by aiproxy and s3proxy and the multi-binary-plus-license shape used by database-tools.","source":"@site/docs/packages/go-release.md","sourceDirName":"packages","slug":"/packages/go-release","permalink":"/docs/packages/go-release","draft":false,"unlisted":false,"tags":[],"version":"current","sidebarPosition":6,"frontMatter":{"sidebar_label":"Go Release","sidebar_position":6},"sidebar":"packagesSidebar","previous":{"title":"Confluence","permalink":"/docs/packages/confluence"}}');
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(1325);
// EXTERNAL MODULE: ./node_modules/.pnpm/@mdx-js+react@3.1.1_@types+react@19.2.14_react@19.2.6/node_modules/@mdx-js/react/lib/index.js
var lib = __webpack_require__(1982);
;// ./docs/packages/go-release.md


const frontMatter = {
	sidebar_label: 'Go Release',
	sidebar_position: 6
};
const contentTitle = '@repo-toolkit/go-release';

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
  "value": "Single Binary",
  "id": "single-binary",
  "level": 3
}, {
  "value": "Multiple Binaries And A License",
  "id": "multiple-binaries-and-a-license",
  "level": 3
}, {
  "value": "Configuration",
  "id": "configuration",
  "level": 2
}, {
  "value": "Verification Limits",
  "id": "verification-limits",
  "level": 3
}, {
  "value": "Precedence",
  "id": "precedence",
  "level": 3
}, {
  "value": "CLI",
  "id": "cli",
  "level": 2
}, {
  "value": "Library API",
  "id": "library-api",
  "level": 2
}, {
  "value": "Artifact Contract",
  "id": "artifact-contract",
  "level": 2
}, {
  "value": "Atomicity And Managed Output",
  "id": "atomicity-and-managed-output",
  "level": 2
}, {
  "value": "Thin Consumers",
  "id": "thin-consumers",
  "level": 2
}, {
  "value": "Migration Notes",
  "id": "migration-notes",
  "level": 2
}, {
  "value": "Non-Goals",
  "id": "non-goals",
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
        id: "repo-toolkitgo-release",
        children: (0,jsx_runtime.jsx)(_components.code, {
          children: "@repo-toolkit/go-release"
        })
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "@repo-toolkit/go-release"
      }), " builds an explicit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GOOS"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: "GOARCH"
      }), " matrix, creates deterministic ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tar.gz"
      }), " files, writes SHA-256 checksums, and verifies release output before publication. It supports the single-binary shape used by ", (0,jsx_runtime.jsx)(_components.code, {
        children: "aiproxy"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "s3proxy"
      }), " and the multi-binary-plus-license shape used by ", (0,jsx_runtime.jsx)(_components.code, {
        children: "database-tools"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "The package does not infer products or targets. The repository owns binary package paths, target matrices, version text, archive names, and additional files."
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "requirements",
      children: "Requirements"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "Node.js 20 or newer."
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["A Go executable for build and reproducibility operations. Verification without ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--reproducibility"
        }), " does not invoke Go."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["GNU tar or a compatible implementation. Creation requires ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--create"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--format=ustar"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--sort=name"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--mtime=@<epoch>"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--owner"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--group"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--numeric-owner"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--no-recursion"
        }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--file"
        }), ". Extraction requires ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--extract"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--gzip"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--file"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--directory"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--no-same-owner"
        }), ", ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--same-permissions"
        }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--no-overwrite-dir"
        }), "."]
      }), "\n", (0,jsx_runtime.jsx)(_components.li, {
        children: "A filesystem where temporary files can be renamed within the output directory and temporary directories can be renamed from a sibling location into the output path."
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["GNU tar is an external runtime assumption, not an npm dependency. BSD tar commonly lacks the creation flags above. The package uses Node's zlib implementation for deterministic gzip compression, but still uses configured ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tarExecutable"
      }), " for ustar creation and extraction. Unsupported tar behavior fails the operation; there is no portable fallback."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "install",
      children: "Install"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "pnpm add -D @repo-toolkit/go-release\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "tested-configurations",
      children: "Tested Configurations"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "These JSON examples are compared byte-for-byte as parsed objects with fixtures in the package test suite, then built and verified through both CLIs with a controlled fake Go compiler. The archive path uses GNU tar exactly as production does."
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "single-binary",
      children: "Single Binary"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["This models the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "aiproxy"
      }), " layout. It also models ", (0,jsx_runtime.jsx)(_components.code, {
        children: "s3proxy"
      }), " by changing ", (0,jsx_runtime.jsx)(_components.code, {
        children: "toolName"
      }), ", binary name/package, and its version linker value and expected output. Add the remaining repository-supported targets to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "targets"
      }), " as needed."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-json",
        children: "{\n  \"toolName\": \"aiproxy\",\n  \"version\": \"1.2.3\",\n  \"outputDir\": \"dist\",\n  \"binaries\": [\n    {\n      \"name\": \"aiproxy\",\n      \"package\": \"cmd/aiproxy\",\n      \"linkerValues\": [\n        {\n          \"symbol\": \"main.version\",\n          \"value\": \"{version}/{os}-{arch}\"\n        }\n      ],\n      \"versionCommand\": {\n        \"args\": [\"version\"],\n        \"expectedOutput\": \"{version}/{os}-{arch}\\n\",\n        \"match\": \"exact\"\n      }\n    }\n  ],\n  \"targets\": [\n    { \"os\": \"linux\", \"arch\": \"amd64\" },\n    { \"os\": \"darwin\", \"arch\": \"arm64\" },\n    { \"os\": \"windows\", \"arch\": \"amd64\" }\n  ],\n  \"linkerFlags\": [\"-buildid=\", \"-s\", \"-w\"],\n  \"checksumFile\": \"checksums.txt\",\n  \"sourceDateEpoch\": 0,\n  \"processLimits\": {\n    \"timeoutMs\": 120000,\n    \"maxOutputBytes\": 1048576,\n    \"concurrency\": 2\n  }\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "The result contains target build directories, one archive per target, and the configured manifest:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-text",
        children: "dist/\n  darwin-arm64/aiproxy\n  linux-amd64/aiproxy\n  windows-amd64/aiproxy.exe\n  aiproxy-darwin-arm64.tar.gz\n  aiproxy-linux-amd64.tar.gz\n  aiproxy-windows-amd64.tar.gz\n  checksums.txt\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "multiple-binaries-and-a-license",
      children: "Multiple Binaries And A License"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["This models the ", (0,jsx_runtime.jsx)(_components.code, {
        children: "database-tools"
      }), " layout. Each target archive contains both executables and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "LICENSE"
      }), "; Windows binary names receive ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".exe"
      }), " automatically."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-json",
        children: "{\n  \"toolName\": \"database-tools\",\n  \"version\": \"1.2.3\",\n  \"outputDir\": \"dist\",\n  \"binaries\": [\n    {\n      \"name\": \"mongo-archive\",\n      \"package\": \"mongoarchive/main/mongoarchive.go\",\n      \"linkerValues\": [\n        {\n          \"symbol\": \"main.version\",\n          \"value\": \"{version} {os}-{arch}\"\n        }\n      ],\n      \"versionCommand\": {\n        \"args\": [\"--version\"],\n        \"expectedOutput\": \"mongo-archive version: {version} {os}-{arch}\\n\"\n      }\n    },\n    {\n      \"name\": \"mongo-unarchive\",\n      \"package\": \"mongounarchive/main/mongounarchive.go\",\n      \"linkerValues\": [\n        {\n          \"symbol\": \"main.version\",\n          \"value\": \"{version} {os}-{arch}\"\n        }\n      ],\n      \"versionCommand\": {\n        \"args\": [\"--version\"],\n        \"expectedOutput\": \"mongo-unarchive version: {version} {os}-{arch}\\n\"\n      }\n    }\n  ],\n  \"targets\": [\n    { \"os\": \"linux\", \"arch\": \"amd64\" },\n    { \"os\": \"linux\", \"arch\": \"arm64\" },\n    { \"os\": \"windows\", \"arch\": \"amd64\" }\n  ],\n  \"additionalFiles\": [{ \"source\": \"LICENSE\", \"destination\": \"LICENSE\" }]\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "configuration",
      children: "Configuration"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The CLI loads JSON directly. An ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".mjs"
      }), " file must default-export an object; a ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".cjs"
      }), " module may export the object through ", (0,jsx_runtime.jsx)(_components.code, {
        children: "module.exports"
      }), ". JavaScript configuration is useful when a repository must derive a static field such as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "checksumFile"
      }), ", but configuration is executable code and should be treated as trusted repository input."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["All unknown top-level and nested keys are rejected. Relative paths are rooted at ", (0,jsx_runtime.jsx)(_components.code, {
        children: "cwd"
      }), ", normalized, and must remain inside the project. The complete plan is validated before output is created or replaced. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "runner"
      }), " is available only to library callers and is not accepted from serializable configuration."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "Field"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Required/default"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Contract"
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "toolName"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Required"
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Safe filename used by the default archive template."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "version"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Required"
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Nonempty filename-safe value; no SemVer normalization or leading-", (0,jsx_runtime.jsx)(_components.code, {
              children: "v"
            }), " policy is applied."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "cwd"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Current working directory"
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Existing project root. ", (0,jsx_runtime.jsx)(_components.code, {
              children: "--cwd"
            }), " also controls resolution of a relative config path."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "outputDir"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "dist"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Relative managed directory below ", (0,jsx_runtime.jsx)(_components.code, {
              children: "cwd"
            }), "; cannot be the project root."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "goExecutable"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "go"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Executable or path passed directly to the process runner."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "tarExecutable"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "tar"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "GNU-compatible tar executable or path."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "binaries"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Required, nonempty"
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Unique output ", (0,jsx_runtime.jsx)(_components.code, {
              children: "name"
            }), ", relative Go ", (0,jsx_runtime.jsx)(_components.code, {
              children: "package"
            }), ", optional linker values and version command."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "targets"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Required, nonempty"
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Unique lowercase ", (0,jsx_runtime.jsx)(_components.code, {
              children: "{ os, arch }"
            }), " pairs. The package validates token syntax, not whether the Go toolchain supports a pair."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "buildFlags"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "[-trimpath, -buildvcs=false]"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Arguments placed after ", (0,jsx_runtime.jsx)(_components.code, {
              children: "go build"
            }), "."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "linkerFlags"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "[-buildid=]"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Values combined into one ", (0,jsx_runtime.jsx)(_components.code, {
              children: "-ldflags"
            }), " argument before binary-specific ", (0,jsx_runtime.jsx)(_components.code, {
              children: "-X"
            }), " assignments."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "archiveName"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "{tool}-{os}-{arch}.tar.gz"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Safe filename template; generated names must be unique and end in ", (0,jsx_runtime.jsx)(_components.code, {
              children: ".tar.gz"
            }), "."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "checksumFile"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "SHA256SUMS"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Safe literal filename. Template tokens are not expanded here."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "additionalFiles"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "[]"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Existing non-symlink regular source files outside ", (0,jsx_runtime.jsx)(_components.code, {
              children: "outputDir"
            }), ", each mapped to a unique relative archive destination."]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "sourceDateEpoch"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "0"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Non-negative integer used for every tar member modification time."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "processLimits.timeoutMs"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "120000"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Positive timeout passed to each Go and tar invocation and each version command."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "processLimits.maxOutputBytes"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "1048576"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Positive bound for captured or piped child output, including Go build and tar diagnostics."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "processLimits.concurrency"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "2"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Positive maximum number of target builds in flight. Binaries within one target build serially."
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The supported template tokens are ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{tool}"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{version}"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{os}"
      }), ", and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "{arch}"
      }), ". They are expanded in ", (0,jsx_runtime.jsx)(_components.code, {
        children: "archiveName"
      }), ", linker values, version-command arguments, and expected version output. A linker value rejects quotes, backslashes, NULs, and line breaks because the implementation must represent it safely in the single Go ", (0,jsx_runtime.jsx)(_components.code, {
        children: "-ldflags"
      }), " argument."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "versionCommand.match"
      }), " defaults to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "exact"
      }), ", which compares all captured stdout including its trailing newline. ", (0,jsx_runtime.jsx)(_components.code, {
        children: "anchored"
      }), " means the expected text must equal one complete output line; it is not a regular expression. Version commands run only for targets matching the verifier host OS and architecture. Incompatible cross-compiled binaries are never executed."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "verification-limits",
      children: "Verification Limits"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "verifyGoRelease"
      }), " accepts ", (0,jsx_runtime.jsx)(_components.code, {
        children: "archiveLimits"
      }), "; the verify CLI accepts the same object in its config and allows individual CLI overrides. Defaults are also hard maximums, so callers may lower but not raise them:"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "Field"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Default and maximum"
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "maxMemberCount"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "1024"
            })
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "maxPathLength"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "512"
            }), " bytes"]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "maxExpandedBytes"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: [(0,jsx_runtime.jsx)(_components.code, {
              children: "536870912"
            }), " bytes per archive"]
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["A config containing ", (0,jsx_runtime.jsx)(_components.code, {
        children: "archiveLimits"
      }), " is verifier-specific and is rejected by the build CLI. To share one config between build and verify, omit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "archiveLimits"
      }), " and use verify CLI flags, or keep a separate verifier config."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "precedence",
      children: "Precedence"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Configuration values are loaded first. Explicit CLI values then override ", (0,jsx_runtime.jsx)(_components.code, {
        children: "cwd"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "toolName"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "version"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "outputDir"
      }), ", executable paths, and concurrency. Verify limit flags override individual ", (0,jsx_runtime.jsx)(_components.code, {
        children: "archiveLimits"
      }), " fields. Finally, omitted values receive the built-in defaults above."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "--target"
      }), " is a repeatable, comma-aware build-only filter over configured names such as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "linux-amd64"
      }), "; it does not add targets. A filtered build replaces the managed directory with only that subset. Verification always checks every target in its resolved config. The library-only ", (0,jsx_runtime.jsx)(_components.code, {
        children: "targetSubset"
      }), " option can limit independent reproducibility checks; full-plan comparison is the default."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "cli",
      children: "CLI"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Inspect the authoritative option lists with:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-build-go-release --help\nrepo-toolkit-verify-go-release --help\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Build all configured targets and override the repository's placeholder version:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-build-go-release --config go-release.json --version 1.2.3\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Resolve and print a deterministic, secrets-free summary without creating output or running Go or tar:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-build-go-release --config go-release.json --target linux-amd64 --dry-run\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Verify existing archives and their checksum manifest:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-verify-go-release --config go-release.json\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Also perform two clean, independent builds and compare archive names, sizes, and SHA-256 digests:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-verify-go-release --config go-release.json --reproducibility\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The build command performs build, archive, and checksum phases. The verify command validates existing output; it rebuilds only when ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--reproducibility"
      }), " is present. Both commands print JSON summaries and return nonzero on validation, process, archive, checksum, or reproducibility failure."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "library-api",
      children: "Library API"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import {\n  buildGoRelease,\n  createGoReleaseArchives,\n  verifyGoRelease,\n  verifyGoReleaseReproducibility,\n  writeGoReleaseChecksums,\n} from '@repo-toolkit/go-release';\n\nawait buildGoRelease(options);\nawait createGoReleaseArchives(options);\nawait verifyGoRelease(options);\nawait verifyGoReleaseReproducibility(options);\nwriteGoReleaseChecksums(options);\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "API"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Responsibility"
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "resolveGoReleasePlan(options)"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Runtime-validate and resolve the complete readonly plan without invoking processes or mutating output. It does inspect project paths and additional files."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "buildGoRelease(options)"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Cross-compile every configured binary and replace the managed build tree."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "createGoReleaseArchives(options)"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Create each target archive from an already completed build tree, then write the checksum manifest."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "writeGoReleaseChecksums(options)"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Recompute the manifest for the exact configured archive set without rebuilding archives."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "verifyGoRelease(options)"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Check the manifest, validate archive headers and exact member sets, extract into temporary storage, validate the extracted tree, and run compatible version commands."
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "verifyGoReleaseReproducibility(options)"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Produce and verify two releases in independent temporary roots and compare exact archive sets, sizes, and hashes without touching normal output."
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Library callers can inject a ", (0,jsx_runtime.jsx)(_components.code, {
        children: "GoReleaseRunner"
      }), " with structured ", (0,jsx_runtime.jsx)(_components.code, {
        children: "run(executable, args, options)"
      }), " and ", (0,jsx_runtime.jsx)(_components.code, {
        children: "capture(...)"
      }), " methods. CLI-loaded configuration cannot inject a runner. There is no shell-string API. The default runner merges explicit environment overrides with the parent environment, applies timeout and captured-output limits, and reports the executable without printing inherited environment values. Tar operations clear ambient ", (0,jsx_runtime.jsx)(_components.code, {
        children: "TAR_OPTIONS"
      }), " so inherited flags cannot alter creation or extraction."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "artifact-contract",
      children: "Artifact Contract"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Each target gets one gzip-compressed strict ustar archive. Its members are exactly the target's binary names plus configured additional destinations. Non-Windows binaries are mode ", (0,jsx_runtime.jsx)(_components.code, {
        children: "0755"
      }), "; Windows binaries and additional files are mode ", (0,jsx_runtime.jsx)(_components.code, {
        children: "0644"
      }), ". Members are sorted, have modification time ", (0,jsx_runtime.jsx)(_components.code, {
        children: "sourceDateEpoch"
      }), ", numeric uid/gid ", (0,jsx_runtime.jsx)(_components.code, {
        children: "0"
      }), ", and deterministic gzip metadata. Reproducibility still depends on deterministic Go compiler inputs and a compatible tar implementation."]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "The checksum manifest contains exactly one entry per configured archive, sorted by archive filename. Every line is lowercase SHA-256, two ASCII spaces, the basename, and LF:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-text",
        children: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  aiproxy-linux-amd64.tar.gz\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The verifier requires both the output directory's ", (0,jsx_runtime.jsx)(_components.code, {
        children: ".tar.gz"
      }), " names and the manifest's names to equal the planned archive set, and rejects malformed hashes, alternate separators, duplicate or unsafe names, missing entries, additional entries, and digest mismatches. Before copying or extraction it bounds manifest, compressed, and expanded data and rejects traversal, absolute or non-normalized paths, duplicate paths, nonzero tar padding, links, devices, FIFOs, sparse files, unsupported types, wrong modes, and unexpected members. It then validates extracted containment, types, sizes, permissions, and nonempty binaries."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "atomicity-and-managed-output",
      children: "Atomicity And Managed Output"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "outputDir"
      }), " is package-managed. A build stages the complete selected matrix in a temporary sibling and validates every expected binary before replacement. A failed build preserves the prior managed output and cleans staging. A successful build replaces the entire directory, so do not store coverage, SBOMs, signatures, or unrelated files there before building."]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Archive creation stages members separately and writes each tarball to a temporary sibling before rename. The checksum manifest is also replaced through a temporary sibling. These are per-file guarantees, not a transaction across all archives and the manifest: a later archive failure can occur after earlier archives were published. Build output remains available when archive or checksum creation fails. OS or process crashes are outside the operation-level rollback guarantee."
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Verification snapshots archives into package-owned temporary storage before parsing and extraction and always removes that storage. Reproducibility uses two temporary roots under ", (0,jsx_runtime.jsx)(_components.code, {
        children: "cwd"
      }), ", leaves normal ", (0,jsx_runtime.jsx)(_components.code, {
        children: "outputDir"
      }), " untouched, and removes both roots on success or failure."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "thin-consumers",
      children: "Thin Consumers"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "A Makefile should delegate release mechanics rather than duplicate them:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-makefile",
        children: "VERSION ?= dev\n\n.PHONY: release-build release-verify\nrelease-build:\n\tpnpm exec repo-toolkit-build-go-release --config go-release.json --version \"$(VERSION)\"\n\nrelease-verify:\n\tpnpm exec repo-toolkit-verify-go-release --config go-release.json --version \"$(VERSION)\" --reproducibility\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "A GitHub Actions job can consume the verified output and leave publication concerns to separate steps:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-yaml",
        children: "- uses: actions/checkout@v4\n- uses: actions/setup-node@v4\n  with:\n    node-version: 20\n- uses: pnpm/action-setup@v4\n- uses: actions/setup-go@v5\n  with:\n    go-version-file: go.mod\n- run: pnpm install --frozen-lockfile\n- name: Build and verify release archives\n  env:\n    VERSION: ${{ github.ref_name }}\n  run: |\n    pnpm exec repo-toolkit-build-go-release --config go-release.json --version \"$VERSION\"\n    pnpm exec repo-toolkit-verify-go-release --config go-release.json --version \"$VERSION\" --reproducibility\n- uses: actions/upload-artifact@v4\n  with:\n    name: release-${{ github.ref_name }}\n    path: |\n      dist/*.tar.gz\n      dist/SHA256SUMS\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Ubuntu runners provide GNU tar. If a job uses another operating system or container, install GNU tar and set ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tarExecutable"
      }), " or ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--tar-executable"
      }), " to its actual path. Tag validation, source-SHA validation, tests, vulnerability checks, SBOM generation, signing, provenance, image publication, GitHub Release creation, and asset upload policy remain separate workflow responsibilities."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "migration-notes",
      children: "Migration Notes"
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Decide whether ", (0,jsx_runtime.jsx)(_components.code, {
          children: "version"
        }), " includes a leading ", (0,jsx_runtime.jsx)(_components.code, {
          children: "v"
        }), "; the package preserves the value exactly. The reference repositories currently differ in whether workflows strip it."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Match each program's real version output. ", (0,jsx_runtime.jsx)(_components.code, {
          children: "aiproxy"
        }), " and ", (0,jsx_runtime.jsx)(_components.code, {
          children: "s3proxy"
        }), " print only their injected value, while the two ", (0,jsx_runtime.jsx)(_components.code, {
          children: "database-tools"
        }), " binaries prefix it differently. Exact matching includes the final newline."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["The default archive is ", (0,jsx_runtime.jsx)(_components.code, {
          children: "{tool}-{os}-{arch}.tar.gz"
        }), " and does not include ", (0,jsx_runtime.jsx)(_components.code, {
          children: "version"
        }), ". Override ", (0,jsx_runtime.jsx)(_components.code, {
          children: "archiveName"
        }), " if an existing release does. All generated names must remain unique."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["The default checksum name is ", (0,jsx_runtime.jsx)(_components.code, {
          children: "SHA256SUMS"
        }), ". ", (0,jsx_runtime.jsx)(_components.code, {
          children: "aiproxy"
        }), " currently uses ", (0,jsx_runtime.jsx)(_components.code, {
          children: "checksums.txt"
        }), ", while ", (0,jsx_runtime.jsx)(_components.code, {
          children: "database-tools"
        }), " uses a versioned ", (0,jsx_runtime.jsx)(_components.code, {
          children: ".txt"
        }), " name. ", (0,jsx_runtime.jsx)(_components.code, {
          children: "checksumFile"
        }), " is literal and has no template expansion; use a fixed compatibility name or trusted JavaScript config that computes it before planning."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["Existing archives may include ", (0,jsx_runtime.jsx)(_components.code, {
          children: "./"
        }), " prefixes or differing modes. This package emits normalized member names and strict modes and will reject legacy layouts that do not exactly match the plan."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["A successful build replaces all of ", (0,jsx_runtime.jsx)(_components.code, {
          children: "outputDir"
        }), ". Move unrelated outputs elsewhere and generate SBOMs or signatures only after the release build."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["A ", (0,jsx_runtime.jsx)(_components.code, {
          children: "--target"
        }), " build publishes only the selected subset. Do not use a partial local build as the input to a verifier configured for the full release matrix."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: ["The package sets ", (0,jsx_runtime.jsx)(_components.code, {
          children: "CGO_ENABLED=0"
        }), ". Releases requiring CGO or platform-native toolchains are outside this contract."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "non-goals",
      children: "Non-Goals"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "The package does not create or push tags, validate tag/SHA/version-file consistency, create GitHub Releases, upload assets, generate SBOMs, signatures, attestations, or provenance, publish container images, run arbitrary test/lint/integration/deployment pipelines, apply vulnerability policy, parse application configuration, or generate asdf plugins. Consumer repository migration is separate work."
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