import json, subprocess
RPC="https://bsc-dataseed.bnbchain.org"
def rpc(method, params):
    p=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params})
    out=subprocess.run(["curl","-sS","-m","25","-X","POST",RPC,"-H","Content-Type: application/json","--data",p],capture_output=True,text=True).stdout
    return json.loads(out)
def has_code(addr, blk):
    r=rpc("eth_getCode",[addr,hex(blk)])
    return r.get("result","0x") not in ("0x","")
addr="0x23791aa3b031659b593cf141a2bc76b0ad657777"
latest=int(rpc("eth_blockNumber",[])["result"],16)
lo,hi=1,latest
while lo<hi:
    mid=(lo+hi)//2
    if has_code(addr,mid): hi=mid
    else: lo=mid+1
print("token deploy block ~", lo)
# also impl
addr="0x024f18294970b5c76c0691b87f138a0317156422"
lo,hi=1,latest
while lo<hi:
    mid=(lo+hi)//2
    if has_code(addr,mid): hi=mid
    else: lo=mid+1
print("impl deploy block ~", lo)
