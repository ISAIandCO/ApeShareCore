import { fillUrlTemplate } from "../values/url.js";
import { classifyIp } from "../values/ip.js";
export const BUILTIN_PROVIDERS = Object.freeze([
  { id: "virustotal-ip", name: "VirusTotal — IP", type: "ip", urlTemplate: "https://www.virustotal.com/gui/ip-address/${ip}/details", allowPrivate: true, enabled: true },
  { id: "abuseipdb-ip", name: "AbuseIPDB — IP", type: "ip", urlTemplate: "https://www.abuseipdb.com/check/${ip}", allowPrivate: true, enabled: true },
  { id: "opentip-ip", name: "Kaspersky OpenTIP — IP", type: "ip", urlTemplate: "https://opentip.kaspersky.com/${ip}", allowPrivate: true, enabled: true },
  { id: "shodan-ip", name: "Shodan — IP", type: "ip", urlTemplate: "https://www.shodan.io/host/${ip}", allowPrivate: true, enabled: true },
  { id: "greynoise-ip", name: "GreyNoise — IP", type: "ip", urlTemplate: "https://viz.greynoise.io/ip/${ip}", allowPrivate: true, enabled: true },
  { id: "virustotal-hash", name: "VirusTotal — хеш", type: "hash", urlTemplate: "https://www.virustotal.com/gui/file/${hash}/detection", enabled: true },
  { id: "opentip-hash", name: "Kaspersky OpenTIP — хеш", type: "hash", urlTemplate: "https://opentip.kaspersky.com/${hash}", enabled: true },
  { id: "malwarebazaar-hash", name: "MalwareBazaar — хеш", type: "hash", urlTemplate: "https://bazaar.abuse.ch/sample/${hash}/", enabled: true },
  { id: "virustotal-domain", name: "VirusTotal — домен", type: "domain", urlTemplate: "https://www.virustotal.com/gui/domain/${domain}/details", enabled: true },
  { id: "opentip-domain", name: "Kaspersky OpenTIP — домен", type: "domain", urlTemplate: "https://opentip.kaspersky.com/${domain}", enabled: true },
  { id: "opentip-url", name: "Kaspersky OpenTIP — URL", type: "url", urlTemplate: "https://opentip.kaspersky.com/${url}", enabled: true },
  { id: "urlhaus-url", name: "URLhaus — URL", type: "url", urlTemplate: "https://urlhaus.abuse.ch/browse.php?search=${url}", enabled: true },
]);

export function reportLinks(ioc, providers = BUILTIN_PROVIDERS) {
  const type = ["md5", "sha1", "sha256"].includes(ioc?.type) ? "hash" : ioc?.type;
  if (!type) return [];
  return providers.filter(provider => provider.enabled && provider.type === type).flatMap(provider => {
    if (type === "ip") {
      const category = classifyIp(ioc.value);
      if (category === "invalid" || category !== "public" && !provider.allowPrivate) return [];
    }
    const url = fillUrlTemplate(provider.urlTemplate, { [type]: ioc.value });
    return url ? [{ id: provider.id, provider: provider.name, url: url.href }] : [];
  });
}
