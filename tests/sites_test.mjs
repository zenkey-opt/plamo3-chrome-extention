// Unit check of the autoPageSkip helpers in lib/settings.js (no browser needed).
// usage: node tests/sites_test.mjs
import { parseSites, siteSkipped, toggleSite } from '../extension/lib/settings.js';

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

const list = 'example.com\nhttps://News.Site.org/path?q=1\n# comment\n*.wild.net\nhost.jp:8080\n';
eq('parse hosts, URLs, comments, wildcards, ports', parseSites(list), ['example.com', 'news.site.org', 'wild.net', 'host.jp']);
eq('CRLF lines', parseSites('a.com\r\nb.com'), ['a.com', 'b.com']);
eq('exact host', siteSkipped('example.com', list), true);
eq('subdomain', siteSkipped('www.example.com', list), true);
eq('other host with the same ending', siteSkipped('badexample.com', list), false);
eq('wildcard entry', siteSkipped('a.wild.net', list), true);
eq('entry with a port', siteSkipped('host.jp', list), true);
eq('empty host', siteSkipped('', list), false);
const a = toggleSite('', '127.0.0.1', true);
eq('add', a, '127.0.0.1');
eq('add twice', toggleSite(a, '127.0.0.1', true), '127.0.0.1');
eq('add to a covered subdomain', toggleSite('example.com', 'www.example.com', true), 'example.com');
eq('remove keeps the rest', toggleSite('127.0.0.1\nexample.com', '127.0.0.1', false), 'example.com');
eq('remove the covering entry', toggleSite('example.com\nfoo.org', 'www.example.com', false), 'foo.org');
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
