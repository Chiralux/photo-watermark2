// 包装字体名：必要时加引号，并追加合理的回退字体栈
export function wrapFontFamily(name?: string) {
  if (!name) return 'system-ui, Arial, sans-serif'
  const needsQuote = /[\s,]/.test(name)
  const quoted = needsQuote ? `"${name}"` : name
  return `${quoted}, system-ui, Arial, sans-serif`
}
