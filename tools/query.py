import json, subprocess, time, sys
RPCS = ["https://bsc.publicnode.com", "https://bsc-dataseed1.bnbchain.org"]
def rpc(method, params, rpc=None):
    for url in ([rpc] if rpc else RPCS):
        p = json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params})
        out = subprocess.run(["curl","-sS","-m","30","-X","POST",url,"-H","Content-Type: application/json","--data",p], capture_output=True, text=True).stdout
        try:
            r = json.loads(out)
        except Exception:
            continue
        if "result" in r: return r["result"], url
        time.sleep(1.5)
    return None, None

def call(addr, sig_hex, rpc=None):
    res, url = rpc("eth_call", [{"to": addr, "data": sig_hex}, "latest"], rpc)
    if res is None: return None
    h = res[2:]
    if len(h) >= 64:
        v = int(h[:64], 16)
        # signed interpretation
        sv = v - (1<<256) if v >= (1<<255) else v
        return v
    return res

if __name__ == "__main__":
    T = "0x23791aa3b031659b593cf141a2bc76b0ad657777"
    funcs = {
      "owner()":"0x8da5cb5b","buyTaxRate()":"0x691f224f","sellTaxRate()":"0x24024efd",
      "taxRate()":"0x771a3a1d","taxExpirationTime()":"0xb85a0638","taxProcessor()":"0xf3635019",
      "maxSupply()":"0xd5abeb01","mainPool()":"0xa5a302d3","quoteToken()":"0x217a4b70",
      "v2Router()":"0xdeadbc14","state()":"0xc19d93fb","antiFarmerDuration()":"0x7f3e1969",
      "antiFarmerExpirationTime()":"0x5bc129bf","dividendContract()":"0x6124e4e7",
      "totalSupply()":"0x18160ddd","metaURI()":"0x67605787",
      "MIN_LIQ_THRESHOLD()":"0xb74b8edf","START_LIQ_THRESHOLD()":"0xa15d5da0",
    }
    for name, sel in funcs.items():
        v = call(T, sel)
        if v is None: print(f"{name:28s} <no result>")
        elif v < 2**160 and v > 0: print(f"{name:28s} {v}  (0x{v:040x})")
        else: print(f"{name:28s} {v}")
        time.sleep(0.4)
