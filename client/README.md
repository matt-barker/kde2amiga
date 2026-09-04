# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Installer

Converted archives carry Installer 43.3 so they can be installed on an Amiga that has no
Installer of its own. Only the binary and its licence are redistributed; `Installer.guide`
and the sample scripts are not, per licence clause B.3.

    Installer and Installer project icon (c) Copyright 1995-96 Escom AG.  All Rights Reserved.  Reproduced and distributed under license from Escom AG.

    INSTALLER SOFTWARE IS PROVIDED "AS-IS" AND SUBJECT TO CHANGE; NO WARRANTIES ARE MADE.  ALL USE IS AT YOUR OWN RISK.  NO LIABILITY OR RESPONSIBILITY IS ASSUMED.

Clause B.10 requires a signed agreement posted to AMIGA Technologies GmbH, which has not
existed since 1996. That term cannot be satisfied; every other term is met.
