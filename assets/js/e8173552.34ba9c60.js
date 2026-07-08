"use strict";
(globalThis["webpackChunkwebsite"] = globalThis["webpackChunkwebsite"] || []).push([[501],{

/***/ 1232
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  assets: () => (/* binding */ assets),
  contentTitle: () => (/* binding */ contentTitle),
  "default": () => (/* binding */ MDXContent),
  frontMatter: () => (/* binding */ frontMatter),
  metadata: () => (/* reexport */ site_docs_packages_changelog_javascript_api_md_e81_namespaceObject),
  toc: () => (/* binding */ toc)
});

;// ./.docusaurus/docusaurus-plugin-content-docs/default/site-docs-packages-changelog-javascript-api-md-e81.json
const site_docs_packages_changelog_javascript_api_md_e81_namespaceObject = /*#__PURE__*/JSON.parse('{"id":"packages/changelog/javascript-api","title":"JavaScript API","description":"generateChangelog(options)","source":"@site/docs/packages/changelog/javascript-api.md","sourceDirName":"packages/changelog","slug":"/packages/changelog/javascript-api","permalink":"/docs/packages/changelog/javascript-api","draft":false,"unlisted":false,"tags":[],"version":"current","sidebarPosition":4,"frontMatter":{"sidebar_label":"JavaScript API","sidebar_position":4},"sidebar":"packagesSidebar","previous":{"title":"Config File","permalink":"/docs/packages/changelog/config"},"next":{"title":"Preset Options","permalink":"/docs/packages/changelog/preset-options"}}');
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(1325);
// EXTERNAL MODULE: ./node_modules/.pnpm/@mdx-js+react@3.1.1_@types+react@19.2.14_react@19.2.6/node_modules/@mdx-js/react/lib/index.js
var lib = __webpack_require__(1982);
;// ./docs/packages/changelog/javascript-api.md


const frontMatter = {
	sidebar_label: 'JavaScript API',
	sidebar_position: 4
};
const contentTitle = 'JavaScript API';

const assets = {

};



const toc = [{
  "value": "<code>generateChangelog(options)</code>",
  "id": "generatechangelogoptions",
  "level": 2
}, {
  "value": "Pipeline Options",
  "id": "pipeline-options",
  "level": 3
}, {
  "value": "<code>createGenerator(options)</code>",
  "id": "creategeneratoroptions",
  "level": 2
}, {
  "value": "<code>createPreset(options)</code>",
  "id": "createpresetoptions",
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
    p: "p",
    pre: "pre",
    table: "table",
    tbody: "tbody",
    td: "td",
    th: "th",
    thead: "thead",
    tr: "tr",
    ...(0,lib/* useMDXComponents */.R)(),
    ...props.components
  };
  return (0,jsx_runtime.jsxs)(jsx_runtime.Fragment, {
    children: [(0,jsx_runtime.jsx)(_components.header, {
      children: (0,jsx_runtime.jsx)(_components.h1, {
        id: "javascript-api",
        children: "JavaScript API"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "generatechangelogoptions",
      children: (0,jsx_runtime.jsx)(_components.code, {
        children: "generateChangelog(options)"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Runs the generator and writes the changelog to disk. Returns a promise that\nresolves to the absolute output path."
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import { generateChangelog } from '@repo-toolkit/changelog';\n\nawait generateChangelog({\n  outputFile: 'CHANGELOG.md',\n  tagPrefix: 'v',\n  issuePrefixes: ['#', 'WEB-'],\n  scope: 'api',\n});\n"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The working directory is switched to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "options.cwd"
      }), " (default ", (0,jsx_runtime.jsx)(_components.code, {
        children: "process.cwd()"
      }), ")\nwhile the generator runs and restored afterward, so git metadata is read from\nthe intended repository."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h3, {
      id: "pipeline-options",
      children: "Pipeline Options"
    }), "\n", (0,jsx_runtime.jsxs)(_components.table, {
      children: [(0,jsx_runtime.jsx)(_components.thead, {
        children: (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.th, {
            children: "Option"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Default"
          }), (0,jsx_runtime.jsx)(_components.th, {
            children: "Description"
          })]
        })
      }), (0,jsx_runtime.jsxs)(_components.tbody, {
        children: [(0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "cwd"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "process.cwd()"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Working directory for git metadata"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "outputFile"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "CHANGELOG.md"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Output file path (relative to ", (0,jsx_runtime.jsx)(_components.code, {
              children: "cwd"
            }), ", or absolute)"]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "append"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Append to the output instead of prepending"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "releaseCount"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "0"
            })
          }), (0,jsx_runtime.jsxs)(_components.td, {
            children: ["Number of releases to include (", (0,jsx_runtime.jsx)(_components.code, {
              children: "0"
            }), " = all)"]
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "skipUnstable"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "true"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Skip unstable (prerelease) releases"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "outputUnreleased"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "true"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Include an unreleased section"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "tagPrefix"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "v"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Tag prefix to match"
          })]
        }), (0,jsx_runtime.jsxs)(_components.tr, {
          children: [(0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "firstRelease"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: (0,jsx_runtime.jsx)(_components.code, {
              children: "false"
            })
          }), (0,jsx_runtime.jsx)(_components.td, {
            children: "Include all commits when no prior release tag exists"
          })]
        })]
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["The remaining options are forwarded to the preset — see ", (0,jsx_runtime.jsx)(_components.a, {
        href: "./preset-options",
        children: "Preset Options"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "creategeneratoroptions",
      children: (0,jsx_runtime.jsx)(_components.code, {
        children: "createGenerator(options)"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Builds a configured ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ConventionalChangelog"
      }), " instance without writing to disk.\nUseful when you want to pipe the stream yourself or introspect the generator."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Pipeline-only options (", (0,jsx_runtime.jsx)(_components.code, {
        children: "cwd"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "outputFile"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "append"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "releaseCount"
      }), ",\n", (0,jsx_runtime.jsx)(_components.code, {
        children: "skipUnstable"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "outputUnreleased"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tagPrefix"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "firstRelease"
      }), ") are stripped\nbefore the rest are forwarded to the preset."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import { createGenerator } from '@repo-toolkit/changelog';\n\nconst generator = await createGenerator({ tagPrefix: 'v' });\ngenerator.writeStream().pipe(process.stdout);\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "createpresetoptions",
      children: (0,jsx_runtime.jsx)(_components.code, {
        children: "createPreset(options)"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Builds the conventional-commits preset that ", (0,jsx_runtime.jsx)(_components.code, {
        children: "createGenerator"
      }), " loads. Returns the\npreset object tagged with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "name: 'conventionalcommits'"
      }), ". Useful when you want\nto inspect or reuse the preset independently of the generator."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "import { createPreset } from '@repo-toolkit/changelog';\n\nconst preset = await createPreset({ types: [{ type: 'feat', section: 'Features' }] });\n"
      })
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