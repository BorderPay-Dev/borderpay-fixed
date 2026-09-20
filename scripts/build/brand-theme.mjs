/** Tokenize declaration values only; never alter Tailwind selectors or assets. */
export function brandTheme() {
  return {
    postcssPlugin: "borderpay-brand-theme",
    Declaration(decl) {
      if (
        decl.prop.startsWith("--brand-") ||
        decl.value.includes("--brand-accent")
      ) return;
      decl.value = decl.value
        .replace(
          /#(c7ff00|c6ff00|d4ff33)([a-f0-9]{2})?\b/gi,
          (match, hex, alpha) =>
            alpha
              ? `rgb(var(--brand-accent-rgb, ${
                [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(
                  " ",
                )
              }) / ${parseInt(alpha, 16) / 255})`
              : `var(--brand-accent, ${match})`,
        )
        .replace(
          /rgba?\(\s*199\s*,\s*255\s*,\s*0\s*(?:,\s*([\d.]+))?\)/g,
          (_, alpha) =>
            `rgb(var(--brand-accent-rgb, 199 255 0) / ${alpha || 1})`,
        );
    },
  };
}
