// Import in cms/server.mjs: import {syncContract} from './contract-sync.mjs';
// Place this route before the existing content integration route. It reuses the existing server helpers.
    if (url.pathname === '/api/integrations/contracts' && req.method === 'POST') {
      const secret=integrationSecret();if(!secret)return error(res,503,'INTEGRATION_DISABLED','الربط غير مفعل');
      const given=String(req.headers.authorization||'').replace(/^Bearer /,'');
      if(!crypto.timingSafeEqual(crypto.createHash('sha256').update(given).digest(),crypto.createHash('sha256').update(secret).digest()))return error(res,401,'AUTH_REQUIRED','غير مصرح');
      const body=await readBody(req);const result=await syncContract(db,body,{now,publish:publicItem,storeImage:async url=>storeRemoteMedia(url,'image',[]),audit:(id,title,visible)=>audit(null,'contract_sync','content',id,{title,visible,actor:'مزامنة التعاقدات'},req)});
      exportPublished();return send(res,200,result);
    }
