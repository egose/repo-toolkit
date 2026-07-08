"use strict";
(globalThis["webpackChunkwebsite"] = globalThis["webpackChunkwebsite"] || []).push([[82],{

/***/ 3087
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  assets: () => (/* binding */ assets),
  contentTitle: () => (/* binding */ contentTitle),
  "default": () => (/* binding */ MDXContent),
  frontMatter: () => (/* binding */ frontMatter),
  metadata: () => (/* reexport */ site_docs_packages_changelog_preset_options_md_ce3_namespaceObject),
  toc: () => (/* binding */ toc)
});

;// ./.docusaurus/docusaurus-plugin-content-docs/default/site-docs-packages-changelog-preset-options-md-ce3.json
const site_docs_packages_changelog_preset_options_md_ce3_namespaceObject = /*#__PURE__*/JSON.parse('{"id":"packages/changelog/preset-options","title":"Preset Options","description":"These options are forwarded to the conventional-commits preset and are accepted","source":"@site/docs/packages/changelog/preset-options.md","sourceDirName":"packages/changelog","slug":"/packages/changelog/preset-options","permalink":"/docs/packages/changelog/preset-options","draft":false,"unlisted":false,"tags":[],"version":"current","sidebarPosition":5,"frontMatter":{"sidebar_label":"Preset Options","sidebar_position":5},"sidebar":"packagesSidebar","previous":{"title":"JavaScript API","permalink":"/docs/packages/changelog/javascript-api"},"next":{"title":"Default Sections","permalink":"/docs/packages/changelog/default-sections"}}');
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(1325);
// EXTERNAL MODULE: ./node_modules/.pnpm/@mdx-js+react@3.1.1_@types+react@19.2.14_react@19.2.6/node_modules/@mdx-js/react/lib/index.js
var lib = __webpack_require__(1982);
;// ./docs/packages/changelog/preset-options.md


const frontMatter = {
	sidebar_label: 'Preset Options',
	sidebar_position: 5
};
const contentTitle = 'Preset Options';

const assets = {

};



const toc = [{
  "value": "<code>types</code>",
  "id": "types",
  "level": 2
}, {
  "value": "<code>ignoreCommits</code>",
  "id": "ignorecommits",
  "level": 2
}, {
  "value": "<code>issuePrefixes</code>",
  "id": "issueprefixes",
  "level": 2
}, {
  "value": "<code>scope</code>",
  "id": "scope",
  "level": 2
}, {
  "value": "<code>scopeOnly</code>",
  "id": "scopeonly",
  "level": 2
}, {
  "value": "<code>preMajor</code>",
  "id": "premajor",
  "level": 2
}, {
  "value": "URL Formatters",
  "id": "url-formatters",
  "level": 2
}];
function _createMdxContent(props) {
  const _components = {
    a: "a",
    code: "code",
    h1: "h1",
    h2: "h2",
    header: "header",
    li: "li",
    p: "p",
    pre: "pre",
    ul: "ul",
    ...(0,lib/* useMDXComponents */.R)(),
    ...props.components
  };
  return (0,jsx_runtime.jsxs)(jsx_runtime.Fragment, {
    children: [(0,jsx_runtime.jsx)(_components.header, {
      children: (0,jsx_runtime.jsx)(_components.h1, {
        id: "preset-options",
        children: "Preset Options"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["These options are forwarded to the conventional-commits preset and are accepted\nby ", (0,jsx_runtime.jsx)(_components.code, {
        children: "generateChangelog"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "createGenerator"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "createPreset"
      }), ", and the ", (0,jsx_runtime.jsx)(_components.a, {
        href: "./config",
        children: "config file"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "types",
      children: (0,jsx_runtime.jsx)(_components.code, {
        children: "types"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Type: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "Array<{ type: string; section?: string; scope?: string; effect?: 'bump' | 'changelog' | 'hidden'; hidden?: boolean }>"
      })]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Defines which commit types appear in the changelog and under which section."
    }), "\n", (0,jsx_runtime.jsxs)(_components.ul, {
      children: ["\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "section"
        }), " controls the visible heading for matching commits."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "scope"
        }), " narrows the rule to commits with that scope (e.g. ", (0,jsx_runtime.jsx)(_components.code, {
          children: "fix(deps)"
        }), ")."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "effect"
        }), " controls visibility. ", (0,jsx_runtime.jsx)(_components.code, {
          children: "'hidden'"
        }), " omits the type entirely. ", (0,jsx_runtime.jsx)(_components.code, {
          children: "'bump'"
        }), " and\n", (0,jsx_runtime.jsx)(_components.code, {
          children: "'changelog'"
        }), " are passed through to the upstream preset for bump logic."]
      }), "\n", (0,jsx_runtime.jsxs)(_components.li, {
        children: [(0,jsx_runtime.jsx)(_components.code, {
          children: "hidden: true"
        }), " is the legacy spelling of ", (0,jsx_runtime.jsx)(_components.code, {
          children: "effect: 'hidden'"
        }), " and is still\naccepted for compatibility with older upstream versions."]
      }), "\n"]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: [(0,jsx_runtime.jsx)(_components.code, {
        children: "effect"
      }), " is the preferred field."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "{\n  types: [\n    { type: 'feat', section: 'Features' },\n    { type: 'fix', section: 'Bug Fixes' },\n    { type: 'build', section: 'Build' },\n    { type: 'docs', section: 'Docs' },\n    { type: 'chore', effect: 'hidden' },\n  ],\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "ignorecommits",
      children: (0,jsx_runtime.jsx)(_components.code, {
        children: "ignoreCommits"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Type: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "RegExp"
      })]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "A regex that drops matching commits from the changelog entirely. Only\nexpressible in a JavaScript config file, not JSON."
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "{\n  ignoreCommits: /^chore: release candidate /;\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "issueprefixes",
      children: (0,jsx_runtime.jsx)(_components.code, {
        children: "issuePrefixes"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Type: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ReadonlyArray<string>"
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Tokens that introduce a reference to an issue. Defaults to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "['#']"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "{\n  issuePrefixes: ['#', 'WEB-'];\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "scope",
      children: (0,jsx_runtime.jsx)(_components.code, {
        children: "scope"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Type: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "string | ReadonlyArray<string>"
      })]
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Only include commits whose scope matches one of these values. When omitted,\nall scopes are included."
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "{\n  scope: ['api', 'ui'];\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "scopeonly",
      children: (0,jsx_runtime.jsx)(_components.code, {
        children: "scopeOnly"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Type: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "boolean"
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["When ", (0,jsx_runtime.jsx)(_components.code, {
        children: "true"
      }), ", only commits that have a scope are included (combined with ", (0,jsx_runtime.jsx)(_components.code, {
        children: "scope"
      }), "\nto filter by those specific scopes). Defaults to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "false"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "premajor",
      children: (0,jsx_runtime.jsx)(_components.code, {
        children: "preMajor"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Type: ", (0,jsx_runtime.jsx)(_components.code, {
        children: "boolean"
      })]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["When ", (0,jsx_runtime.jsx)(_components.code, {
        children: "true"
      }), ", the preset operates in pre-major mode (e.g. emit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "BREAKING CHANGES"
      }), "\nunder a different heading). Defaults to ", (0,jsx_runtime.jsx)(_components.code, {
        children: "false"
      }), "."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "url-formatters",
      children: "URL Formatters"
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Customize how issue, commit, compare, and user links are rendered. Each\nreceives the conventional-changelog context object."
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-ts",
        children: "{\n  formatIssueUrl: (context, reference) => `https://jira.example.com/browse/${reference.issue}`,\n  formatCommitUrl: (context, commit) => `https://github.com/egose/repo-toolkit/commit/${commit.hash}`,\n  formatCompareUrl: (context) => `https://github.com/egose/repo-toolkit/compare/${context.previousTag}...${context.currentTag}`,\n  formatUserUrl: (context, user) => `https://github.com/${user}`,\n}\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Only expressible in a JavaScript config file."
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