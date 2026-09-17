import urllib.request, urllib.error, json, hashlib, ssl, socket, re
from datetime import datetime, timezone
from pathlib import Path

BASE = 'https://initiatives.thedao.fund'
OUT = Path('/tmp/asvs-live-evidence.json')
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None
opener = urllib.request.build_opener(NoRedirect)
records = []
def check(path, method='GET', headers=None, base=BASE):
    req = urllib.request.Request(base + path, method=method, headers={'User-Agent': 'TheDAO-authorized-ASVS-review/1.0', **(headers or {})})
    try: res = opener.open(req, timeout=20)
    except urllib.error.HTTPError as e: res = e
    with res:
        body = res.read(600000)
        hs = dict(res.headers.items())
        hs.pop('Set-Cookie', None)
        row = {'at': datetime.now(timezone.utc).isoformat(), 'url': base+path, 'method': method, 'request_headers': headers or {}, 'status': res.status, 'headers': hs, 'body_bytes_sampled': len(body), 'body_sha256': hashlib.sha256(body).hexdigest()}
        if 'application/json' in res.headers.get('Content-Type', ''):
            try:
                obj=json.loads(body)
                row['json_keys']=list(obj) if isinstance(obj,dict) else []
                if path in ['/api/auth/me','/api/admin/dashboard','/api/admin/leads','/api/admin/admins','/api/initiatives/mine','/api/asvs-nonexistent']:
                    row['response']=obj
                if path=='/api/board':
                    Path('/tmp/asvs-live-board.json').write_text(json.dumps(obj))
            except Exception: pass
        records.append(row)
        print(method,base+path,res.status, res.headers.get('Content-Type',''))
        return body

home=check('/')
for path in ['/admin','/submit','/api/board','/api/auth/me','/api/admin/dashboard','/api/admin/leads','/api/admin/admins','/api/initiatives/mine','/healthz','/api/asvs-nonexistent','/robots.txt','/.git/HEAD','/.env','/assets/']:
    check(path)
assets=re.findall(r'(?:src|href)="(/assets/[^"\s]+\.js)"',home.decode())
if assets: check(assets[0])
check('/api/auth/verify','OPTIONS',{'Origin':'https://asvs.invalid','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'})
check('/api/auth/verify','OPTIONS',{'Origin':BASE,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'})
check('/',base='http://initiatives.thedao.fund')
check('/api/auth/me',base='http://initiatives.thedao.fund')
tls=[]
for version in [ssl.TLSVersion.TLSv1_2,ssl.TLSVersion.TLSv1_3]:
    context=ssl.create_default_context();context.minimum_version=version;context.maximum_version=version
    try:
        with socket.create_connection(('initiatives.thedao.fund',443),timeout=10) as sock:
            with context.wrap_socket(sock,server_hostname='initiatives.thedao.fund') as conn:
                cert=conn.getpeercert()
                tls.append({'requested':version.name,'negotiated':conn.version(),'cipher':conn.cipher(),'issuer':cert.get('issuer'),'notAfter':cert.get('notAfter'),'subjectAltName':cert.get('subjectAltName')})
    except Exception as e: tls.append({'requested':version.name,'error':str(e)})
OUT.write_text(json.dumps({'records':records,'tls':tls},indent=2))
print('Saved',OUT,'with',len(records),'requests')
