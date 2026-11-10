// The browser running the extension, for text that names it or its internal pages: brave://extensions
// in Brave, chrome://extensions in Chrome (and as the fallback; every Chromium browser accepts chrome://).
// Opening such pages from code keeps chrome:// URLs, which Brave maps to its own.
export function browserInfo() {
  const brands = (navigator.userAgentData?.brands || []).map((b) => b.brand);
  if (navigator.brave || brands.includes('Brave')) return { name: 'Brave', scheme: 'brave' };
  return { name: 'Chrome', scheme: 'chrome' };
}

/** An internal page of the running browser, as text to show: internalPage('extensions') -> "brave://extensions". */
export const internalPage = (path) => `${browserInfo().scheme}://${path}`;
