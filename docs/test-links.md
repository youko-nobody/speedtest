# Public Speed-Test Links

These are examples of public download-test endpoints. Check each provider page before using them, keep traffic bounded, and prefer your own `tb server` for sustained upload/download burn-in.

## Leaseweb

Leaseweb publishes speed-test hosts by region and file names such as `10mb.bin`, `100mb.bin`, `1000mb.bin`, and `10000mb.bin`.

Example:

```text
https://speedtest.ams1.nl.leaseweb.net/1000mb.bin
```

Source: [Leaseweb Link Speeds & Speed tests](https://kb.leaseweb.com/kb/network/network-link-speeds/)

## SpeedyPage

SpeedyPage publishes looking-glass test files by location using the `{location}.lg.speedypage.com` format.

Example:

```text
https://lon.lg.speedypage.com/1GB.test
```

Source: [SpeedyPage network looking glass and test files](https://speedypage.com/docs/general/network-looking-glass)

## OVHcloud

OVHcloud provides `proof.ovh.net` for file downloads and iperf3 tests.

Example:

```text
https://proof.ovh.net/files/1Gb.dat
```

Source: [OVHcloud proof.ovh.net](https://proof.ovh.net/)

## Hetzner

Hetzner provides regional speed-test pages with files such as `100MB.bin`, `1GB.bin`, and `10GB.bin`.

Example:

```text
https://nbg1-speed.hetzner.com/1GB.bin
```

Source: [Hetzner NBG1 test files](https://nbg1-speed.hetzner.com/)

## Scaleway

Scaleway's public net-test page includes test files and warns that scripts should not exceed 40 GB per day per IP.

Source: [Scaleway net-test](https://scaleway.testdebit.info/)

## Additional Official Pools

The script also includes official/test-file endpoints from:

- [Hostiserver Speedtest](https://www.hostiserver.com/speedtest)
- [MilkyWan Speedtest](https://speedtest.milkywan.fr/)
- [Artfiles Speedtest](https://speed.af.de/)
- [VelociHOST Network Speed Test](https://www.velocihost.net/network-speed-test/)
- [BITel Speedtest](https://speedtest.bitel.io/)
- [Serverius Speedtest](https://speedtest.serverius.net/)
- [Liquid Web Looking Glass](https://www.liquidweb.com/help-docs/performance/server-optimization/testing-your-networks-speed-and-reliability/)

## Avoid For Automation

ThinkBroadband's download test page says its files are for broadband testing, but it does not allow scripted or automated downloads. Do not use it with this tool.

Source: [ThinkBroadband download test files](https://www.thinkbroadband.com/download)
