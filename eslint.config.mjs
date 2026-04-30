import { FlatCompat } from "@eslint/eslintrc"

const compat = new FlatCompat({ baseDirectory: import.meta.dirname })

const config = [
    ...compat.extends("next/core-web-vitals", "next/typescript"),
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
