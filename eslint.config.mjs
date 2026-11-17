import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

const config = [
    ...nextCoreWebVitals,
    ...nextTypescript,
    {
        // New in eslint-plugin-react-hooks 7 (Next 16). The code predates them; they stay
        // visible as warnings until the patterns are reworked, like the other warnings.
        rules: {
            "react-hooks/refs": "warn",
            "react-hooks/static-components": "warn",
            "react-hooks/set-state-in-effect": "warn",
        },
    },
    {
        // Lint only application source. Skip e2e tests (relaxed style is fine
        // there), build output, configs, and Next-generated type files.
        ignores: [
            ".next/**",
            "node_modules/**",
            "playwright-report/**",
            "test-results/**",
            "e2e/**",
            "next-env.d.ts",
            "*.config.{js,mjs,ts}",
            "playwright.config.ts",
        ],
    },
]

export default config
