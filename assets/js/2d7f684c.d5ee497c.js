"use strict";
(globalThis["webpackChunkwebsite"] = globalThis["webpackChunkwebsite"] || []).push([[663],{

/***/ 4611
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  assets: () => (/* binding */ assets),
  contentTitle: () => (/* binding */ contentTitle),
  "default": () => (/* binding */ MDXContent),
  frontMatter: () => (/* binding */ frontMatter),
  metadata: () => (/* reexport */ site_docs_packages_changelog_config_md_2d7_namespaceObject),
  toc: () => (/* binding */ toc)
});

;// ./.docusaurus/docusaurus-plugin-content-docs/default/site-docs-packages-changelog-config-md-2d7.json
const site_docs_packages_changelog_config_md_2d7_namespaceObject = /*#__PURE__*/JSON.parse('{"id":"packages/changelog/config","title":"Config File","description":"Use --config when you want repo-specific options such as custom commit types,","source":"@site/docs/packages/changelog/config.md","sourceDirName":"packages/changelog","slug":"/packages/changelog/config","permalink":"/docs/packages/changelog/config","draft":false,"unlisted":false,"tags":[],"version":"current","sidebarPosition":3,"frontMatter":{"sidebar_label":"Config File","sidebar_position":3},"sidebar":"packagesSidebar","previous":{"title":"CLI","permalink":"/docs/packages/changelog/cli"},"next":{"title":"JavaScript API","permalink":"/docs/packages/changelog/javascript-api"}}');
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(1325);
// EXTERNAL MODULE: ./node_modules/.pnpm/@mdx-js+react@3.1.1_@types+react@19.2.14_react@19.2.6/node_modules/@mdx-js/react/lib/index.js
var lib = __webpack_require__(1982);
;// ./docs/packages/changelog/config.md


const frontMatter = {
	sidebar_label: 'Config File',
	sidebar_position: 3
};
const contentTitle = 'Config File';

const assets = {

};



const toc = [{
  "value": "Example",
  "id": "example",
  "level": 2
}, {
  "value": "JSON vs. JavaScript Config",
  "id": "json-vs-javascript-config",
  "level": 2
}];
function _createMdxContent(props) {
  const _components = {
    a: "a",
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
        id: "config-file",
        children: "Config File"
      })
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Use ", (0,jsx_runtime.jsx)(_components.code, {
        children: "--config"
      }), " when you want repo-specific options such as custom commit ", (0,jsx_runtime.jsx)(_components.code, {
        children: "types"
      }), ",\nscope filtering, ignored commits, or custom issue and commit URLs."]
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "example",
      children: "Example"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-js",
        children: "/** @type {import('@repo-toolkit/changelog').ChangelogConfig} */\nexport default {\n  ignoreCommits: /^chore: release candidate /,\n  issuePrefixes: ['#', 'WEB-'],\n  scope: ['api', 'ui'],\n  scopeOnly: true,\n  types: [\n    { type: 'feat', section: 'Features' },\n    { type: 'fix', section: 'Bug Fixes' },\n    { type: 'build', section: 'Build' },\n    { type: 'docs', section: 'Docs' },\n    { type: 'chore', effect: 'hidden' },\n  ],\n};\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "Run it with:"
    }), "\n", (0,jsx_runtime.jsx)(_components.pre, {
      children: (0,jsx_runtime.jsx)(_components.code, {
        className: "language-sh",
        children: "repo-toolkit-changelog --config changelog.config.mjs\n"
      })
    }), "\n", (0,jsx_runtime.jsx)(_components.p, {
      children: "CLI flags override values from the config file."
    }), "\n", (0,jsx_runtime.jsx)(_components.h2, {
      id: "json-vs-javascript-config",
      children: "JSON vs. JavaScript Config"
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["Use a JavaScript config file (", (0,jsx_runtime.jsx)(_components.code, {
        children: ".mjs"
      }), "/", (0,jsx_runtime.jsx)(_components.code, {
        children: ".cjs"
      }), ") when you need ", (0,jsx_runtime.jsx)(_components.code, {
        children: "RegExp"
      }), " values such\nas ", (0,jsx_runtime.jsx)(_components.code, {
        children: "ignoreCommits"
      }), " or formatter callbacks such as ", (0,jsx_runtime.jsx)(_components.code, {
        children: "formatIssueUrl"
      }), ". JSON config\nfiles only work for plain data options."]
    }), "\n", (0,jsx_runtime.jsxs)(_components.p, {
      children: ["For the full list of supported options, see ", (0,jsx_runtime.jsx)(_components.a, {
        href: "./preset-options",
        children: "Preset Options"
      }), ".\nThe config file accepts every option documented there, plus the pipeline options\nfrom the ", (0,jsx_runtime.jsx)(_components.a, {
        href: "./javascript-api",
        children: "JavaScript API"
      }), " (", (0,jsx_runtime.jsx)(_components.code, {
        children: "outputFile"
      }), ", ", (0,jsx_runtime.jsx)(_components.code, {
        children: "tagPrefix"
      }), ",\n", (0,jsx_runtime.jsx)(_components.code, {
        children: "releaseCount"
      }), ", etc.)."]
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