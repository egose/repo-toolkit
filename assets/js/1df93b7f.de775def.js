"use strict";
(globalThis["webpackChunkwebsite"] = globalThis["webpackChunkwebsite"] || []).push([[583],{

/***/ 1791
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": () => (/* binding */ Home)
});

// EXTERNAL MODULE: ./node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
var clsx = __webpack_require__(3526);
// EXTERNAL MODULE: ./node_modules/.pnpm/@docusaurus+core@3.10.1_@mdx-js+react@3.1.1_@types+react@19.2.14_react@19.2.6__postcss@_8e4f15980c67c89e41a59896d33471aa/node_modules/@docusaurus/core/lib/client/exports/Link.js
var Link = __webpack_require__(7313);
// EXTERNAL MODULE: ./node_modules/.pnpm/@docusaurus+core@3.10.1_@mdx-js+react@3.1.1_@types+react@19.2.14_react@19.2.6__postcss@_8e4f15980c67c89e41a59896d33471aa/node_modules/@docusaurus/core/lib/client/exports/useDocusaurusContext.js
var useDocusaurusContext = __webpack_require__(909);
// EXTERNAL MODULE: ./node_modules/.pnpm/@docusaurus+theme-classic@3.10.1_@types+react@19.2.14_react-dom@19.2.6_react@19.2.6__react@19.2.6_typescript@6.0.3/node_modules/@docusaurus/theme-classic/lib/theme/Layout/index.js + 72 modules
var Layout = __webpack_require__(2721);
// EXTERNAL MODULE: ./node_modules/.pnpm/@docusaurus+theme-classic@3.10.1_@types+react@19.2.14_react-dom@19.2.6_react@19.2.6__react@19.2.6_typescript@6.0.3/node_modules/@docusaurus/theme-classic/lib/theme/Heading/index.js + 1 modules
var Heading = __webpack_require__(4644);
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/index.js
var react = __webpack_require__(489);
;// ./static/img/changelog.svg
var _desc, _defs, _rect, _path, _path2, _path3, _rect2, _text;
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }

const SvgChangelog = ({
  title,
  titleId,
  ...props
}) => /*#__PURE__*/react.createElement("svg", _extends({
  xmlns: "http://www.w3.org/2000/svg",
  "aria-labelledby": titleId,
  viewBox: "0 0 512 512"
}, props), title === undefined ? /*#__PURE__*/react.createElement("title", {
  id: titleId
}, "Conventional Changelog") : title ? /*#__PURE__*/react.createElement("title", {
  id: titleId
}, title) : null, _desc || (_desc = /*#__PURE__*/react.createElement("desc", null, "A document with changelog entry lines and a version tag.")), _defs || (_defs = /*#__PURE__*/react.createElement("defs", null, /*#__PURE__*/react.createElement("linearGradient", {
  id: "a",
  x1: 80,
  x2: 432,
  y1: 60,
  y2: 452,
  gradientUnits: "userSpaceOnUse"
}, /*#__PURE__*/react.createElement("stop", {
  offset: 0,
  stopColor: "#fff4ea"
}), /*#__PURE__*/react.createElement("stop", {
  offset: 1,
  stopColor: "#ffe2cc"
})))), _rect || (_rect = /*#__PURE__*/react.createElement("rect", {
  width: 416,
  height: 416,
  x: 48,
  y: 48,
  fill: "url(#a)",
  rx: 40
})), _path || (_path = /*#__PURE__*/react.createElement("path", {
  fill: "#fffaf5",
  stroke: "#c25800",
  strokeLinejoin: "round",
  strokeWidth: 6,
  d: "M180 112h120l64 64v176c0 17.673-14.327 32-32 32H180c-17.673 0-32-14.327-32-32V144c0-17.673 14.327-32 32-32Z"
})), _path2 || (_path2 = /*#__PURE__*/react.createElement("path", {
  fill: "#ffd1b3",
  stroke: "#c25800",
  strokeLinejoin: "round",
  strokeWidth: 6,
  d: "M300 112v56c0 8.837 7.163 16 16 16h48Z"
})), _path3 || (_path3 = /*#__PURE__*/react.createElement("path", {
  stroke: "#e06800",
  strokeLinecap: "round",
  strokeWidth: 8,
  d: "M180 220h132M180 260h168M180 300h120M180 340h152"
})), _rect2 || (_rect2 = /*#__PURE__*/react.createElement("rect", {
  width: 88,
  height: 36,
  x: 316,
  y: 96,
  fill: "#c25800",
  rx: 18
})), _text || (_text = /*#__PURE__*/react.createElement("text", {
  x: 360,
  y: 120,
  fill: "#fff8f1",
  fontFamily: "Inter, Arial, sans-serif",
  fontSize: 20,
  fontWeight: 700,
  textAnchor: "middle"
}, "v1.2.3")));
/* harmony default export */ const changelog = (SvgChangelog);
;// ./static/img/docs.svg
var docs_desc, docs_defs, docs_rect, docs_path, docs_path2, docs_path3, _path4;
function docs_extends() { return docs_extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, docs_extends.apply(null, arguments); }

const SvgDocs = ({
  title,
  titleId,
  ...props
}) => /*#__PURE__*/react.createElement("svg", docs_extends({
  xmlns: "http://www.w3.org/2000/svg",
  "aria-labelledby": titleId,
  viewBox: "0 0 512 512"
}, props), title === undefined ? /*#__PURE__*/react.createElement("title", {
  id: titleId
}, "Workspace-Centered Docs") : title ? /*#__PURE__*/react.createElement("title", {
  id: titleId
}, title) : null, docs_desc || (docs_desc = /*#__PURE__*/react.createElement("desc", null, "An open book representing centralized documentation for workspace packages.")), docs_defs || (docs_defs = /*#__PURE__*/react.createElement("defs", null, /*#__PURE__*/react.createElement("linearGradient", {
  id: "a",
  x1: 80,
  x2: 432,
  y1: 60,
  y2: 452,
  gradientUnits: "userSpaceOnUse"
}, /*#__PURE__*/react.createElement("stop", {
  offset: 0,
  stopColor: "#fff4ea"
}), /*#__PURE__*/react.createElement("stop", {
  offset: 1,
  stopColor: "#ffe2cc"
})))), docs_rect || (docs_rect = /*#__PURE__*/react.createElement("rect", {
  width: 416,
  height: 416,
  x: 48,
  y: 48,
  fill: "url(#a)",
  rx: 40
})), docs_path || (docs_path = /*#__PURE__*/react.createElement("path", {
  fill: "#fff8f1",
  stroke: "#c25800",
  strokeLinejoin: "round",
  strokeWidth: 6,
  d: "M128 128h120c22.091 0 40 17.909 40 40v196c0-22.091-17.909-40-40-40H128Z"
})), docs_path2 || (docs_path2 = /*#__PURE__*/react.createElement("path", {
  fill: "#fffaf5",
  stroke: "#c25800",
  strokeLinejoin: "round",
  strokeWidth: 6,
  d: "M384 128H264c-22.091 0-40 17.909-40 40v196c0-22.091 17.909-40 40-40h120Z"
})), docs_path3 || (docs_path3 = /*#__PURE__*/react.createElement("path", {
  stroke: "#e06800",
  strokeLinecap: "round",
  strokeWidth: 8,
  d: "M160 172h68M160 208h68M284 172h68M284 208h68M284 244h52"
})), _path4 || (_path4 = /*#__PURE__*/react.createElement("path", {
  stroke: "#c25800",
  strokeLinecap: "round",
  strokeWidth: 6,
  d: "M256 168v200"
})));
/* harmony default export */ const docs = (SvgDocs);
;// ./static/img/publish.svg
var publish_desc, publish_defs, publish_rect, publish_path, publish_path2, publish_path3, publish_path4, _path5;
function publish_extends() { return publish_extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, publish_extends.apply(null, arguments); }

const SvgPublish = ({
  title,
  titleId,
  ...props
}) => /*#__PURE__*/react.createElement("svg", publish_extends({
  xmlns: "http://www.w3.org/2000/svg",
  "aria-labelledby": titleId,
  viewBox: "0 0 512 512"
}, props), title === undefined ? /*#__PURE__*/react.createElement("title", {
  id: titleId
}, "Monorepo Publishing") : title ? /*#__PURE__*/react.createElement("title", {
  id: titleId
}, title) : null, publish_desc || (publish_desc = /*#__PURE__*/react.createElement("desc", null, "Stacked package boxes with an upward arrow representing publishing to a registry.")), publish_defs || (publish_defs = /*#__PURE__*/react.createElement("defs", null, /*#__PURE__*/react.createElement("linearGradient", {
  id: "a",
  x1: 80,
  x2: 432,
  y1: 60,
  y2: 452,
  gradientUnits: "userSpaceOnUse"
}, /*#__PURE__*/react.createElement("stop", {
  offset: 0,
  stopColor: "#fff4ea"
}), /*#__PURE__*/react.createElement("stop", {
  offset: 1,
  stopColor: "#ffe2cc"
})))), publish_rect || (publish_rect = /*#__PURE__*/react.createElement("rect", {
  width: 416,
  height: 416,
  x: 48,
  y: 48,
  fill: "url(#a)",
  rx: 40
})), publish_path || (publish_path = /*#__PURE__*/react.createElement("path", {
  fill: "#fff8f1",
  stroke: "#c25800",
  strokeLinejoin: "round",
  strokeWidth: 6,
  d: "m256 104 120 56v120l-120 56-120-56V160Z"
})), publish_path2 || (publish_path2 = /*#__PURE__*/react.createElement("path", {
  stroke: "#e06800",
  strokeLinecap: "round",
  strokeWidth: 6,
  d: "m136 160 120 56M256 216l120-56M256 216v120"
})), publish_path3 || (publish_path3 = /*#__PURE__*/react.createElement("path", {
  fill: "none",
  stroke: "#c25800",
  strokeLinecap: "round",
  strokeWidth: 6,
  d: "M176 340v32c0 13.255 10.745 24 24 24h112c13.255 0 24-10.745 24-24v-32"
})), publish_path4 || (publish_path4 = /*#__PURE__*/react.createElement("path", {
  fill: "none",
  stroke: "#c25800",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 6,
  d: "m232 372 24-24 24 24"
})), _path5 || (_path5 = /*#__PURE__*/react.createElement("path", {
  d: "M256 348v48"
})));
/* harmony default export */ const publish = (SvgPublish);
;// ./src/components/HomepageFeatures/styles.module.css
// extracted by mini-css-extract-plugin
/* harmony default export */ const styles_module = ({"features":"features_t9lD","featureSvg":"featureSvg_GfXr"});
// EXTERNAL MODULE: ./node_modules/.pnpm/react@19.2.6/node_modules/react/jsx-runtime.js
var jsx_runtime = __webpack_require__(1325);
;// ./src/components/HomepageFeatures/index.tsx
const FeatureList=[{title:'Conventional Changelog',Svg:changelog,description:/*#__PURE__*/(0,jsx_runtime.jsx)(jsx_runtime.Fragment,{children:"Generate CHANGELOG.md from conventional commits with a configurable preset and CLI."})},{title:'Monorepo Publishing',Svg:publish,description:/*#__PURE__*/(0,jsx_runtime.jsx)(jsx_runtime.Fragment,{children:"Build, stage, and publish every package in a pnpm workspace to npm in dependency order."})},{title:'Workspace-Centered Docs',Svg:docs,description:/*#__PURE__*/(0,jsx_runtime.jsx)(jsx_runtime.Fragment,{children:"Keep detailed package documentation in one Docusaurus site while leaving concise package READMEs locally."})}];function Feature({title,Svg,description}){return/*#__PURE__*/(0,jsx_runtime.jsxs)("div",{className:(0,clsx/* default */.A)('col col--4'),children:[/*#__PURE__*/(0,jsx_runtime.jsx)("div",{className:"text--center",children:/*#__PURE__*/(0,jsx_runtime.jsx)(Svg,{className:styles_module.featureSvg,role:"img"})}),/*#__PURE__*/(0,jsx_runtime.jsxs)("div",{className:"text--center padding-horiz--md",children:[/*#__PURE__*/(0,jsx_runtime.jsx)(Heading/* default */.A,{as:"h3",children:title}),/*#__PURE__*/(0,jsx_runtime.jsx)("p",{children:description})]})]});}function HomepageFeatures(){return/*#__PURE__*/(0,jsx_runtime.jsx)("section",{className:styles_module.features,children:/*#__PURE__*/(0,jsx_runtime.jsx)("div",{className:"container",children:/*#__PURE__*/(0,jsx_runtime.jsx)("div",{className:"row",children:FeatureList.map((props,idx)=>/*#__PURE__*/(0,jsx_runtime.jsx)(Feature,{...props},idx))})})});}
;// ./src/pages/index.module.css
// extracted by mini-css-extract-plugin
/* harmony default export */ const index_module = ({"heroBanner":"heroBanner_qdFl","buttons":"buttons_AeoN"});
;// ./src/pages/index.tsx
function HomepageHeader(){const{siteConfig}=(0,useDocusaurusContext/* default */.A)();return/*#__PURE__*/(0,jsx_runtime.jsx)("header",{className:(0,clsx/* default */.A)('hero hero--primary',index_module.heroBanner),children:/*#__PURE__*/(0,jsx_runtime.jsxs)("div",{className:"container",children:[/*#__PURE__*/(0,jsx_runtime.jsx)(Heading/* default */.A,{as:"h1",className:"hero__title",children:siteConfig.title}),/*#__PURE__*/(0,jsx_runtime.jsx)("p",{className:"hero__subtitle",children:siteConfig.tagline}),/*#__PURE__*/(0,jsx_runtime.jsx)("div",{className:index_module.buttons,children:/*#__PURE__*/(0,jsx_runtime.jsx)(Link/* default */.A,{className:"button button--secondary button--lg",to:"/docs/packages",children:"Browse Package Docs"})})]})});}function Home(){const{siteConfig}=(0,useDocusaurusContext/* default */.A)();return/*#__PURE__*/(0,jsx_runtime.jsxs)(Layout/* default */.A,{title:siteConfig.title,description:"Documentation for the repo-toolkit workspace packages.",children:[/*#__PURE__*/(0,jsx_runtime.jsx)(HomepageHeader,{}),/*#__PURE__*/(0,jsx_runtime.jsx)("main",{children:/*#__PURE__*/(0,jsx_runtime.jsx)(HomepageFeatures,{})})]});}

/***/ }

}]);