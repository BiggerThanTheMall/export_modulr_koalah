// ==UserScript==
// @name         LTOA - Export Modulr vers Koalah
// @namespace    https://ltoa-assurances.fr/
// @version      0.4.3
// @description  Export d'une fiche client Modulr vers Koalah avec contrôle Individuel/Famille.
// @match        https://courtage.modulr.fr/*
// @match        https://plateforme.ltoa-assurances.fr/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @updateURL    https://raw.githubusercontent.com/BiggerThanTheMall/export_modulr_koalah/main/export_modulr_koalah.user.js
// @downloadURL  https://raw.githubusercontent.com/BiggerThanTheMall/export_modulr_koalah/main/export_modulr_koalah.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  const STORE = "ltoa_modulr_koalah_pending_v2";
  const TOKEN_PREFIX="ltoa_koalah_import_";
  const MAX_IMPORT_AGE=10*60*1000;
  const KOALAH_NEW = "https://plateforme.ltoa-assurances.fr/clients/nouveau";
  const AUTO_SUBMIT = false;
  const clean = (v) => (v || "").replace(/\s+/g, " ").trim();
  const norm = (v) => clean(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  function valueByLabel(doc, wanted) {
    const target = norm(wanted);
    for (const block of doc.querySelectorAll(".car_template_field,.card_template_field")) {
      const ps = block.querySelectorAll("p");
      if (ps.length >= 2 && norm(ps[0].textContent).includes(target)) {
        const value = clean(ps[1].textContent);
        return norm(value).includes("non renseigne") ? "" : value;
      }
    }
    return "";
  }

  function readBirthDate(doc){
    const valid=(v)=>{
      const text=clean(v);
      const iso=text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
      if(iso)return iso[0];
      const fr=text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);
      return fr?fr[3]+"-"+fr[2].padStart(2,"0")+"-"+fr[1].padStart(2,"0"):"";
    };
    const identityBlock=[...doc.querySelectorAll(".car_template_field,.card_template_field")].find(n=>norm(n.querySelector("p")?.textContent)==="date de naissance");
    const fromIdentity=valid(identityBlock?.querySelectorAll("p")[1]?.textContent||"");
    if(fromIdentity)return fromIdentity;
    const fromLabel=valid(valueByLabel(doc,"Date de naissance"));
    if(fromLabel)return fromLabel;
    const candidates=[...doc.querySelectorAll("input, time, [data-field], [data-name], .car_template_field, .card_template_field, dt, dd, tr")];
    for(const node of candidates){
      const key=norm([node.getAttribute("name"),node.id,node.getAttribute("data-field"),node.getAttribute("data-name"),node.getAttribute("aria-label"),node.tagName==="INPUT"?node.closest("div")?.textContent:node.textContent].filter(Boolean).join(" "));
      if(!/(date de naissance|date_naissance|datenaissance|birthdate|datebirth|date-de-naissance)/.test(key))continue;
      const elems=[node,node.querySelector("input"),node.querySelector("time"),node.nextElementSibling];
      for(const el of elems){
        if(!el)continue;
        const value=valid(el.value||el.getAttribute?.("datetime")||el.textContent);
        if(value)return value;
      }
    }
    // Last resort: scoped text pattern, never guess unrelated dates.
    const body=doc.body?.innerText||doc.body?.textContent||"";
    const match=body.match(/date\s+de\s+naissance\s*[:\-]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}|\d{4}-\d{2}-\d{2})/i);
    return match?valid(match[1]):"";
  }

  function parsePerson(doc, explicitId = "") {
    const cardName = clean(doc.querySelector(".vcard_name")?.textContent);
    const pageTitle = clean(doc.querySelector("h1.page_title")?.textContent);
    const id = explicitId || doc.querySelector("#client_id_")?.value || "";
    let civilite = "";
    if (/^Mme\b/i.test(cardName)) civilite = "Mme";
    else if (/^Mlle\b/i.test(cardName)) civilite = "Mlle";
    else if (/^M\.?\b/i.test(cardName)) civilite = "M";
    let nom = "", prenom = "";
    // Source prioritaire : la vCard Modulr, beaucoup plus propre que le h1 qui peut contenir
    // des libellés/boutons ajoutés par d'autres scripts.
    const identity = cardName.replace(/^(Mme|Mlle|M\.?)(\s+)/i, "");
    if (identity) {
      const upperTail = identity.match(/^(.*?)(\s+)([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý' -]+)$/);
      if (upperTail) {
        prenom = clean(upperTail[1]);
        nom = clean(upperTail[3]);
      } else {
        const commaV = identity.lastIndexOf(",");
        if (commaV > -1) {
          nom = clean(identity.slice(0, commaV));
          prenom = clean(identity.slice(commaV + 1));
        } else {
          const bits = identity.split(/\s+/);
          prenom = bits.shift() || "";
          nom = bits.join(" ");
        }
      }
    }
    // Fallback uniquement si la vCard ne suffit pas.
    if ((!nom || !prenom) && pageTitle) {
      const comma = pageTitle.lastIndexOf(",");
      if (comma > -1) {
        const left = clean(pageTitle.slice(0, comma));
        const right = clean(pageTitle.slice(comma + 1));
        if (!nom) nom = left;
        if (!prenom) prenom = right;
      }
    }
    const addressLines = (doc.querySelector("#address_block_1 .address_block_content")?.innerText || "").split(/\n+/).map(clean).filter(Boolean);
    let codePostal = "", ville = "";
    for (const line of addressLines) {
      const m = line.match(/\b(\d{5})\b\s*(.*)$/);
      if (m) { codePostal = m[1]; ville = clean(m[2]); break; }
    }
    const tel = clean(doc.querySelector('a[href^="tel:"]')?.textContent);
    const emailEl = [...doc.querySelectorAll("a[title]")].find(a => /@/.test(a.getAttribute("title") || ""));
    return {
      modulrId:id, civilite, nom, prenom,
      dateNaissance:readBirthDate(doc),
      lieuNaissance:valueByLabel(doc,"Ville de naissance"),
      paysNaissance:valueByLabel(doc,"Pays de naissance"),
      nationalite:valueByLabel(doc,"Nationalité"),
      situationFamiliale:valueByLabel(doc,"Situation matrimoniale"),
      regimeSocial:valueByLabel(doc,"Régime social") || valueByLabel(doc,"Statut professionnel") || valueByLabel(doc,"Profession"),
      adresse:addressLines[0] || "", codePostal, ville, telephone:tel,
      email:emailEl ? clean(emailEl.getAttribute("title")) : ""
    };
  }


  // Read only text currently present in ModulR. A blank is not evidence of "Non".
  function descriptions(doc){
    const nodes=[...doc.querySelectorAll('[class*="description"],[id*="description"],[class*="contract"],[class*="devis"],textarea')];
    return [...new Set(nodes.map(n=>clean(n.value||n.innerText||n.textContent)).filter(t=>t.length>5&&t.length<15000))].join("\n");
  }
  function inferFromDescription(text){
    const lines=String(text||"").split(/\n|[;|]/).map(clean);
    let pays="",couverture="";
    for(const line of lines){
      let m=line.match(/(?:pays\s*(?:de\s*)?(?:rapatriement|destination)|rapatriement\s*(?:vers|en|au)|destination)\s*[:\-]?\s*([A-Za-zÀ-ÿ' -]{3,45})/i);
      if(m&&!pays)pays=clean(m[1]);
      if(/(?:assur[ée]|couvert|assurance).{0,45}(?:12 derniers mois|douze derniers mois|12 mois)/i.test(line)){
        if(/\b(non|pas|aucun|jamais)\b/i.test(line))couverture="Non";
        else if(/\b(oui|deja|déjà|actuellement)\b/i.test(line))couverture="Oui";
      }
    }
    return {paysRapatriement:pays,assure12Mois:couverture};
  }
  function regimeFromModulr(value){
    const v=norm(value);
    if(/\b(tns|travailleur non salarie|independant|independants|rsi|ssi|msa|agricole|fonction publique|fonctionnaire|regime special)\b/.test(v))return clean(value);
    return "Sécurité sociale";
  }

  function familyLinks(doc) {
    const result = [], seen = new Set();
    for (const a of doc.querySelectorAll('a[href*="/clients/clients_card.php?id="]')) {
      const li = a.closest("li");
      if (!li) continue;
      const text = clean(li.textContent);
      let relation = "";
      if (/\(conjoint\)/i.test(text)) relation = "Conjoint";
      else if (/\(enfant\)/i.test(text)) relation = "Enfant";
      else continue;
      const url = new URL(a.getAttribute("href"), location.origin);
      const id = url.searchParams.get("id");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      result.push({id,relation,url:url.href.split("#")[0],label:clean(a.textContent)});
    }
    return result;
  }

  async function loadRelative(link) {
    try {
      const r = await fetch(link.url,{credentials:"include"});
      if (!r.ok) throw new Error("HTTP "+r.status);
      const html = await r.text();
      const doc = new DOMParser().parseFromString(html,"text/html");
      return {...parsePerson(doc,link.id),relation:link.relation};
    } catch(e) {
      return {modulrId:link.id,relation:link.relation,nom:link.label,prenom:"",_error:e.message};
    }
  }

  function injectStyle() {
    if (document.getElementById("ltoa-k-style")) return;
    const s=document.createElement("style");
    s.id="ltoa-k-style";
    s.textContent=".ltoa-k-missing{border:2px solid #dc2626!important;background:#fff1f2!important;box-shadow:0 0 0 3px #fecdd3!important;font-weight:600!important}.ltoa-k-label-missing{color:#b91c1c!important;font-weight:800!important}.ltoa-k-row-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid #aebdc9;border-radius:5px;background:#f5f8fa;color:#215c7f;padding:4px 7px;cursor:pointer;font-weight:600;font-size:11px;white-space:nowrap}.ltoa-k-row-btn:hover{background:#e4eef5;border-color:#215c7f}.ltoa-k-row-btn img{width:19px;height:19px;object-fit:contain}.ltoa-modal-head{display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:13px;border-bottom:1px solid #e1e8ee}.ltoa-modal-head img{width:45px;height:45px;object-fit:contain;padding:5px;border:1px solid #e1e8ee;border-radius:10px}.ltoa-modal-head h2{margin:0;font-size:19px;color:#193552}.ltoa-modal-head p{margin:4px 0 0;font-size:12px;color:#6b7785}#ltoa-k-overlay{position:fixed;inset:0;z-index:999999;background:#0008;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif}#ltoa-k-modal{width:min(740px,94vw);max-height:88vh;overflow:auto;background:#fff;border-radius:14px;padding:20px;color:#1d2730;box-shadow:0 20px 70px #0006;font-size:13px}#ltoa-k-modal h3{font-size:13px;margin:15px 0 9px;color:#193552}.ltoa-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;background:#f4f7f9;padding:14px;border-radius:8px}.ltoa-person{border:1px solid #d9e0e5;border-radius:8px;padding:10px;margin:8px 0}.ltoa-warn{color:#9b5b00;font-weight:700}.ltoa-ok{color:#19703d;font-weight:700}.ltoa-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.ltoa-actions button{border:0;border-radius:7px;padding:10px 14px;cursor:pointer}.ltoa-primary{background:#215c7f;color:#fff;font-weight:700}.ltoa-extra{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.ltoa-extra label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600}.ltoa-extra input,.ltoa-extra select{border:1px solid #cad5e2;padding:10px;border-radius:8px;background:white;color:#1d2730}.ltoa-extra .ltoa-missing{border:2px solid #dc5555;background:#fffafa}.ltoa-extra .ltoa-complete{border:2px solid #24945c;background:#f7fff9}.ltoa-extra small{font-size:11px;color:#5b6776}#ltoa-k-banner{position:fixed;right:16px;bottom:16px;top:auto;left:auto;width:min(315px,calc(100vw - 32px));z-index:999999;background:#fff;border:1px solid #bbcedc;border-left:4px solid #215c7f;border-radius:11px;padding:11px 13px;box-shadow:0 5px 22px #0002;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#334155;pointer-events:none}#ltoa-k-banner b{color:#193552}#ltoa-k-status{display:block;margin-top:4px;font-size:11px;color:#64748b}";
    document.head.appendChild(s);
  }

  async function openReview() {
    const principal=parsePerson(document), links=familyLinks(document);
    const fromDescription=inferFromDescription(descriptions(document));
    principal.paysRapatriement=fromDescription.paysRapatriement;
    principal.assure12Mois=fromDescription.assure12Mois;
    principal.regimeSocialKoalah=regimeFromModulr(principal.regimeSocial);
    const btn=document.activeElement?.closest?.(".ltoa-k-row-btn")||null;
    if(btn){btn.disabled=true;btn.dataset.originalHtml=btn.innerHTML;btn.textContent="Chargement...";}
    const family=await Promise.all(links.map(loadRelative));
    if(btn){btn.disabled=false;btn.innerHTML=btn.dataset.originalHtml||"KOALAH";}

    const familyHtml = family.length ? family.map((p,i)=>{
      const missing=[];
      if(!p.civilite) missing.push("civilité");
      if(!p.nom) missing.push("nom");
      if(!p.prenom) missing.push("prénom");
      if(!p.dateNaissance) missing.push("date de naissance");
      return '<div class="ltoa-person"><label><input type="checkbox" class="ltoa-member" data-i="'+i+'" checked> <b>'+esc(p.relation)+'</b> — '+esc(p.civilite)+' '+esc(p.prenom)+' '+esc(p.nom)+'</label><div style="margin-left:24px;margin-top:5px">Naissance : '+esc(p.dateNaissance||"Non renseignée")+(missing.length?' <span class="ltoa-warn">· Manque : '+esc(missing.join(", "))+'</span>':' <span class="ltoa-ok">· OK</span>')+'</div></div>';
    }).join("") : "<p>Aucun conjoint/enfant explicite détecté dans les associations Modulr.</p>";

    const overlay=document.createElement("div");
    overlay.id="ltoa-k-overlay";
    overlay.innerHTML='<div id="ltoa-k-modal"><div class="ltoa-modal-head"><img alt="" src="https://plateforme.ltoa-assurances.fr/brand/koalah/koalah-mark.png"><div><h2>Export vers KOALAH</h2><p>Contrôlez les données avant leur transfert</p></div></div><h3>Client principal</h3><div class="ltoa-grid"><div><b>Identité</b><br>'+esc(principal.civilite)+' '+esc(principal.prenom)+' '+esc(principal.nom)+'</div><div><b>Naissance</b><br>'+esc(principal.dateNaissance||"Non renseignée")+' '+esc(principal.lieuNaissance||"")+'</div><div><b>Coordonnées</b><br>'+esc(principal.telephone||"—")+'<br>'+esc(principal.email||"—")+'</div><div><b>Adresse</b><br>'+esc(principal.adresse||"—")+'<br>'+esc(principal.codePostal)+' '+esc(principal.ville)+'</div></div><h3>Informations à compléter</h3><div class="ltoa-extra"><label>Lieu de naissance <input id="ltoa-naissance" type="text" placeholder="Ville de naissance" value="'+esc(principal.lieuNaissance||"") +'"><small>Récupéré de ModulR, modifiable avant export</small></label><label>Pays de rapatriement <input id="ltoa-pays" type="text" placeholder="À renseigner" value="'+esc(principal.paysRapatriement||"")+'"><small>Détection dans les descriptions ModulR, modifiable</small></label><label>Assuré au cours des 12 derniers mois ? <select id="ltoa-12mois"><option value="">À préciser</option><option value="Oui" '+(principal.assure12Mois==="Oui"?"selected":"")+'>Oui</option><option value="Non" '+(principal.assure12Mois==="Non"?"selected":"")+'>Non</option></select><small>Choix manuel si description inconnue</small></label></div><h3>Type Koalah</h3><label style="margin-right:24px"><input type="radio" name="ltoa-type" value="Individuel" '+(family.length?"":"checked")+'> Individuel</label><label><input type="radio" name="ltoa-type" value="Famille" '+(family.length?"checked":"")+'> Famille</label><div id="ltoa-family"><h3>Famille détectée dans Modulr</h3>'+familyHtml+'</div><p class="ltoa-warn">Les champs spécifiques au devis Koalah absents de Modulr resteront à vérifier dans Koalah.</p><div class="ltoa-actions"><button id="ltoa-cancel">Annuler</button><button id="ltoa-send" class="ltoa-primary">Continuer vers Koalah</button></div></div>';
    document.body.appendChild(overlay);

    const refresh=()=>{ const type=overlay.querySelector('input[name="ltoa-type"]:checked').value; overlay.querySelector("#ltoa-family").style.display=type==="Famille"?"block":"none"; };
    overlay.querySelectorAll('input[name="ltoa-type"]').forEach(r=>r.addEventListener("change",refresh)); refresh();
    const updateExtra=()=>{for(const el of [overlay.querySelector("#ltoa-naissance"),overlay.querySelector("#ltoa-pays"),overlay.querySelector("#ltoa-12mois")]){el.classList.toggle("ltoa-complete",!!clean(el.value));el.classList.toggle("ltoa-missing",!clean(el.value));}};
    overlay.querySelector("#ltoa-naissance").addEventListener("input",updateExtra);
    overlay.querySelector("#ltoa-pays").addEventListener("input",updateExtra);
    overlay.querySelector("#ltoa-12mois").addEventListener("change",updateExtra);
    updateExtra();
    overlay.querySelector("#ltoa-cancel").onclick=()=>overlay.remove();
    overlay.querySelector("#ltoa-send").onclick=async()=>{
      const typeContrat=overlay.querySelector('input[name="ltoa-type"]:checked').value;
      principal.lieuNaissance=clean(overlay.querySelector("#ltoa-naissance").value);
      if(!principal.lieuNaissance){overlay.querySelector("#ltoa-naissance").focus();updateExtra();return;}
      principal.paysRapatriement=clean(overlay.querySelector("#ltoa-pays").value);
      principal.assure12Mois=overlay.querySelector("#ltoa-12mois").value;
      // Missing contract answers are allowed: they stay available for manual KOALAH entry.
      let selected=[];
      if(typeContrat==="Famille") selected=[...overlay.querySelectorAll(".ltoa-member:checked")].map(x=>family[Number(x.dataset.i)]);
      const payload={source:{modulrClientId:principal.modulrId,url:location.href},typeContrat,principal,conjoint:selected.find(x=>x.relation==="Conjoint")||null,enfants:selected.filter(x=>x.relation==="Enfant")};
      const token=TOKEN_PREFIX+Date.now()+"_"+Math.random().toString(36).slice(2);
      const send=overlay.querySelector("#ltoa-send");
      send.disabled=true;
      send.textContent="Transfert vers l'onglet KOALAH...";
      // Reuse an already authenticated KOALAH tab via the Tampermonkey cross-tab
      // value listener; never open a fresh authentication context.
      await GM_setValue(STORE,JSON.stringify({token,created:Date.now(),payload}));
      let confirmed=false;
      const ackKey=STORE+"_ack_"+token;
      for(let attempt=0;attempt<20;attempt++){
        await sleep(250);
        if(await GM_getValue(ackKey,false)){confirmed=true;break;}
      }
      if(confirmed){
        overlay.remove();
        const notice=document.createElement("div");
        notice.id="ltoa-k-transfer-notice";
        notice.style.cssText="position:fixed;right:20px;bottom:20px;z-index:999999;background:#193552;color:white;padding:12px 16px;border-radius:10px;box-shadow:0 7px 22px #0003;font:600 13px Arial,sans-serif";
        notice.textContent="Import transmis. Revenez dans votre onglet KOALAH déjà connecté.";
        document.body.appendChild(notice);
        setTimeout(()=>notice.remove(),9000);
      }else{
        // Preserve the user's edited review; do not fall back to opening /login.
        await GM_deleteValue(STORE);
        send.disabled=false;
        send.textContent="Réessayer le transfert";
        const warn=overlay.querySelector("#ltoa-k-no-tab")||document.createElement("p");
        warn.id="ltoa-k-no-tab";
        warn.className="ltoa-warn";
        warn.textContent="Aucun onglet KOALAH actif n'a répondu. Ouvrez KOALAH manuellement, connectez-vous si nécessaire, actualisez cet onglet une fois, puis réessayez.";
        send.parentElement.before(warn);
      }
    };
  }

  function findControl(names,labels,root=document) {
    for(const name of names){
      const byName=root.querySelector('[name="'+CSS.escape(name)+'"]'); if(byName) return byName;
      const byId=root.querySelector("#"+CSS.escape(name)); if(byId) return byId;
      const byAria=root.querySelector('[aria-label="'+CSS.escape(name)+'"]'); if(byAria) return byAria;
    }
    const wanted=labels.map(norm);
    for(const label of root.querySelectorAll("label")){
      const t=norm(label.textContent);
      if(!wanted.some(w=>t===w||t.includes(w))) continue;
      if(label.htmlFor){ const linked=document.getElementById(label.htmlFor); if(linked) return linked; }
      const inside=label.querySelector("input,select,textarea,button,[role=combobox],[role=radio]")||label.parentElement?.querySelector("input,select,textarea,button,[role=combobox],[role=radio]");
      if(inside) return inside;
    }
    // fallback par proximité textuelle
    for(const el of root.querySelectorAll("input,select,textarea,button,[role=combobox],[role=radio]")){
      const around=norm(el.getAttribute("aria-label")||el.getAttribute("placeholder")||el.closest("div")?.textContent||"");
      if(wanted.some(w=>around.includes(w))) return el;
    }
    return null;
  }

  function clickChoiceByText(root,value) {
    const wanted=norm(value);
    const aliases = {
      "m":["m","mr","monsieur"],
      "mme":["mme","madame"],
      "mlle":["mlle","mademoiselle"],
      "individuel":["individuel","indiv"],
      "famille":["famille","familial"]
    };
    const candidates=aliases[wanted]||[wanted];
    const nodes=[...root.querySelectorAll('button,[role="radio"],[role="option"],label')];
    const target=nodes.find(n=>{
      const t=norm(n.textContent);
      return candidates.some(a=>t===a||t.startsWith(a+" ")||t.includes(" "+a+" "));
    });
    if(!target) return false;
    target.click();
    target.dispatchEvent(new Event("change",{bubbles:true}));
    return true;
  }

  function setNative(el,value,root=document) {
    if(!el||value==null||value==="") return false;
    const wanted=norm(value);

    if(el.matches('input[type="radio"]')){
      const name=el.name;
      const radios=name?[...root.querySelectorAll('input[type="radio"][name="'+CSS.escape(name)+'"]')]:[el];
      const aliases=wanted==="m"?["m","mr","monsieur"]:wanted==="mme"?["mme","madame"]:wanted==="individuel"?["individuel","indiv"]:wanted==="famille"?["famille","familial"]:[wanted];
      const radio=radios.find(r=>{
        const txt=norm(r.value+" "+(r.closest("label")?.textContent||""));
        return aliases.some(a=>txt.includes(a));
      });
      if(radio){
        radio.click();
        radio.dispatchEvent(new Event("input",{bubbles:true}));
        radio.dispatchEvent(new Event("change",{bubbles:true}));
        return true;
      }
      return clickChoiceByText(root,value);
    }

    if(el.tagName==="SELECT"){
      const aliases=wanted==="m"?["m","mr","monsieur"]:wanted==="mme"?["mme","madame"]:wanted==="individuel"?["individuel","indiv"]:wanted==="famille"?["famille","familial"]:[wanted];
      const opt=[...el.options].find(o=>{
        const txt=norm(o.value+" "+o.textContent);
        return aliases.some(a=>txt===a||txt.includes(a));
      });
      if(!opt) return false;
      const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value")?.set;
      if(setter)setter.call(el,opt.value);else el.value=opt.value;
      el.dispatchEvent(new Event("input",{bubbles:true}));
      el.dispatchEvent(new Event("change",{bubbles:true}));
      return true;
    }

    if(el.matches('button,[role="radio"]')){
      if(clickChoiceByText(root,value)) return true;
    }

    if(el.matches('[role="combobox"]')){
      el.click();
      const optionRoot=document;
      const option=[...optionRoot.querySelectorAll('[role="option"],li,button')].find(o=>{
        const t=norm(o.textContent);
        return t===wanted||t.includes(wanted);
      });
      if(option){ option.click(); return true; }
    }

    if(el.tagName==="INPUT"||el.tagName==="TEXTAREA"){
      const proto=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
      if(setter) setter.call(el,value); else el.value=value;
      el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:String(value)}));
      el.dispatchEvent(new Event("change",{bubbles:true}));
      el.dispatchEvent(new Event("blur",{bubbles:true}));
      return true;
    }

    return clickChoiceByText(root,value);
  }

  function fill(names,labels,value,root=document){ if(!value) return true; return setNative(findControl(names,labels,root),value,root); }
  function section(regex){ const h=[...document.querySelectorAll("h1,h2,h3,h4,h5,legend,[role=heading]")].find(x=>regex.test(clean(x.textContent))); return h?(h.closest("fieldset,section,article,div")||h.parentElement):null; }
  function fillPerson(person,prefix,root){ if(!person) return []; return [fill([prefix+"civilite"],["Civilité"],person.civilite,root),fill([prefix+"nom"],["Nom"],person.nom,root),fill([prefix+"prenom"],["Prénom"],person.prenom,root),fill([prefix+"dateNaissance"],["Date de naissance"],person.dateNaissance,root),fill([prefix+"lieuNaissance"],["Lieu de naissance","Ville de naissance"],person.lieuNaissance,root)]; }

  // KOALAH is a 3-step React wizard. Never fill controls from another step
  // and never consume the pending payload before reaching the final review.
  const wizardState={busy:false,step:0,finished:false,started:false,lastAction:0,lastUserInput:0};
  const visible=(el)=>!!el&&el.getClientRects().length>0&&!el.disabled;
  function field(label){
    const wanted=norm(label);
    for(const l of document.querySelectorAll("label")){
      if(!visible(l)||norm(l.textContent).replace(/\*/g,"").trim()!==wanted)continue;
      const target=l.htmlFor&&document.getElementById(l.htmlFor);
      if(target&&visible(target))return target;
      // The date input is a sibling of the label's wrapper, not a child.
      // Examine progressively wider ancestors, preferring direct controls.
      for(let box=l.parentElement,depth=0;box&&depth<4;box=box.parentElement,depth++){
        const controls=[...box.querySelectorAll("input,select,textarea,[role=combobox]")].filter(visible);
        if(controls.length===1)return controls[0];
        if(depth>0&&controls.length>1)break;
      }
    }
    return null;
  }
  function normalizedDate(value){
    const v=clean(value);
    if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;
    const m=v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
    if(m)return m[3]+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0");
    return "";
  }
  function valueOf(el){
    if(!el)return "";
    if(el.matches("input[type=checkbox],input[type=radio]"))return el.checked?el.value:"";
    return el.matches("input,select,textarea")?clean(el.value):clean(el.textContent||"");
  }
  function writeField(label,value){
    const el=field(label);
    if(!el||!value)return false;
    if(valueOf(el))return true; // Never overwrite manual corrections.
    const converted=el.type==="date"?normalizedDate(value):value;
    if(!converted)return false;
    setNative(el,converted);
    return valueOf(el)===converted;
  }
  function selectedCivilite(value){
    const wanted=/^(m|mr|monsieur)$/i.test(clean(value))?"Monsieur":/^(mme|mlle|madame|mademoiselle)$/i.test(clean(value))?"Madame":"";
    if(!wanted)return false;
    const group=[...document.querySelectorAll('[role="group"][aria-label]')].find(g=>norm(g.getAttribute("aria-label"))==="civilite");
    const button=group&&[...group.querySelectorAll("button")].find(b=>norm(b.textContent)===norm(wanted));
    if(!button)return false;
    if(button.getAttribute("aria-pressed")!=="true")button.click();
    return true;
  }
  function wizardStep(){
    const text=clean(document.querySelector("main")?.textContent||"");
    const m=text.match(/Étape\s*([123])\s*sur\s*3/i);
    if(m)return Number(m[1]);
    const active=[...document.querySelectorAll("main button")].find(b=>norm(b.textContent)==="identite"&&b.className.includes("bg-blue-600"));
    return active?1:0;
  }
  function requiredMissing(){
    const missing=[];
    for(const l of document.querySelectorAll("main label")){
      if(!visible(l)||!l.querySelector(".text-blue-600")&&!/\*/.test(l.textContent))continue;
      const label=clean(l.textContent).replace(/\*/g,"").trim();
      if(norm(label)==="civilite"){
        const g=document.querySelector('[role="group"][aria-label="Civilité"]');
        if(g&&![...g.querySelectorAll("button")].some(b=>b.getAttribute("aria-pressed")==="true"))missing.push(label);
        continue;
      }
      const el=l.htmlFor?document.getElementById(l.htmlFor):l.parentElement?.querySelector("input,select,textarea,[role=combobox]");
      if(el&&visible(el)&&!valueOf(el))missing.push(label);
    }
    return [...new Set(missing)];
  }
  function nextButton(){
    return [...document.querySelectorAll("main button")].find(b=>visible(b)&&norm(b.textContent)==="suivant");
  }
  function showPause(message){
    const status=document.querySelector("#ltoa-k-status");
    if(status)status.textContent=message;
    const step=Math.max(1,Math.min(3,wizardStep()||wizardState.step||1));
    const progress=document.querySelector("#ltoa-k-progress");
    if(progress)progress.style.width=(step===3?100:(step-1)*33.33)+"%";
    const stepLabel=document.querySelector("#ltoa-k-step");
    if(stepLabel)stepLabel.textContent="Étape "+step+" / 3";
    const missing=document.querySelector("#ltoa-k-missing-list");
    if(missing){
      const empty=[...document.querySelectorAll("main .ltoa-k-missing")].slice(0,4).map(el=>{
        const label=el.closest("div")?.querySelector("label")?.textContent||el.getAttribute("aria-label")||"Champ requis";
        return clean(label).replace(/\*/g,"");
      });
      const radio=document.querySelector('main input[name="aAssuranceDerniers12Mois"]:checked');
      if(step===3&&!radio)empty.push("Assurance obsèques : Oui / Non");
      missing.textContent=empty.length?"À compléter : "+[...new Set(empty)].join(" · "):"Champs obligatoires vérifiés";
    }
  }
  async function fillStep1(p){
    // Change one React-controlled field per render to avoid stale state resets.
    selectedCivilite(p.civilite);
    await sleep(100);
    for(const [label,value] of [["Nom",p.nom],["Prénom",p.prenom],["Date de naissance",p.dateNaissance],["Lieu de naissance",p.lieuNaissance]]){
      const el=field(label);
      if(el&&!valueOf(el)&&value){writeField(label,value);await sleep(150);}
    }
    const date=field("Date de naissance");
    const expected=normalizedDate(p.dateNaissance);
    if(date&&expected&&!date.value){
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
      setter.call(date,expected);
      date.dispatchEvent(new Event("input",{bubbles:true}));
      date.dispatchEvent(new Event("change",{bubbles:true}));
      await sleep(200);
    }
  }
  function stepOneMissing(){
    const result=[];
    const group=document.querySelector('[role="group"][aria-label="Civilité"]');
    if(!group||![...group.querySelectorAll("button")].some(b=>b.getAttribute("aria-pressed")==="true"))result.push("Civilité");
    for(const label of ["Nom","Prénom","Date de naissance","Lieu de naissance"]){
      const el=field(label);
      if(!el||!valueOf(el))result.push(label);
      else if(el.type==="date"&&(!/^\d{4}-\d{2}-\d{2}$/.test(el.value)||!el.checkValidity()))result.push(label);
    }
    return result;
  }
  function fillStep2(p){
    // KOALAH controls use distinct values from ModulR display labels.
    for(const [key,val] of [["Email",p.email],["E-mail",p.email],["Adresse",p.adresse],["Code postal",p.codePostal],["Ville",p.ville]])writeField(key,val);
    const phone=document.querySelector('main input[type="tel"][aria-label="Numéro de téléphone"]')||document.querySelector('main input[autocomplete="tel"]');
    if(phone&&visible(phone)&&!phone.value&&p.telephone)setNative(phone,p.telephone);
    const situation=norm(p.situationFamiliale);
    const situationMap={"celibataire":"Celibataire","celibataire(e)":"Celibataire","concubin":"Concubin","concubin(e)":"Concubin","pacse":"Pacse","pacse(e)":"Pacse","marie":"Marie","marie(e)":"Marie","veuf":"Veuf","veuve":"Veuf","veuf / veuve":"Veuf","divorce":"Divorce","divorce(e)":"Divorce"};
    const status=[...document.querySelectorAll("main select")].find(el=>[...el.options].some(o=>o.value==="Marie")&&[...el.options].some(o=>o.value==="Celibataire"));
    if(status&&visible(status)&&!status.value){
      const mapped=situationMap[situation]||situationMap[Object.keys(situationMap).find(k=>situation.startsWith(k))]||"";
      if(mapped)setNative(status,mapped);
    }
    // Default to general Social Security; an explicit ModulR exception overrides.
    const social=field("Régime social")||field("Régime de sécurité sociale")||field("Régime obligatoire");
    if(social&&visible(social)&&!valueOf(social)){
      if(social.tagName==="SELECT"){
        const wished=norm(p.regimeSocialKoalah||"Sécurité sociale");
        const opt=[...social.options].find(o=>norm(o.textContent)===wished||norm(o.value)===wished)
          ||(wished==="securite sociale"?[...social.options].find(o=>/securite sociale|regime general/i.test(norm(o.textContent))):null);
        if(opt)setNative(social,opt.value);
      }else setNative(social,p.regimeSocialKoalah||"Sécurité sociale");
    }
  }
  function contractButton(type){
    const heading=[...document.querySelectorAll("main label")].find(e=>norm(e.textContent).startsWith("type de contrat"));
    const block=heading?.parentElement;
    if(!block)return null;
    return [...block.querySelectorAll("button")].find(b=>[...b.querySelectorAll("span.font-bold")].some(span=>norm(span.textContent)===norm(type)))||null;
  }
  async function selectContractType(type){
    const target=contractButton(type);
    if(!target)return false;
    if(!target.className.includes("border-blue-300")){
      target.click();
      await sleep(500);
    }
    return !!contractButton(type)?.className.includes("border-blue-300");
  }
  function familySection(){
    const title=[...document.querySelectorAll("main h4")].find(h=>norm(h.textContent)==="composition familiale");
    return title?.closest(".rounded-2xl")||null;
  }
  function familyAddButton(type){
    const box=familySection();
    return [...(box?.querySelectorAll("button")||[])].find(b=>norm(b.textContent)==="ajouter un "+type)||null;
  }
  async function createFamilyFields(payload){
    let box=familySection();
    if(!box)return false;
    if(payload.conjoint&&/aucun conjoint/i.test(box.textContent)){
      const add=familyAddButton("conjoint");
      if(add){add.click();await sleep(450);}
    }
    box=familySection();
    const countLabel=[...box.querySelectorAll("h5")].find(e=>norm(e.textContent)==="enfants");
    const childBox=countLabel?.closest(".rounded-xl");
    const current=Number(childBox?.querySelector("span.rounded-full")?.textContent?.trim()||0);
    for(let i=current;i<(payload.enfants||[]).length;i++){
      const add=familyAddButton("enfant");
      if(!add)break;
      add.click();
      await sleep(400);
    }
    return true;
  }
  function familyCard(kind,index=0){
    const box=familySection();
    if(!box)return null;
    if(kind==="conjoint"){
      return [...box.querySelectorAll("h5")].find(h=>norm(h.textContent)==="conjoint(e)")?.closest(".relative.rounded-xl")||null;
    }
    return [...box.querySelectorAll("p")].find(p=>norm(p.textContent)==="enfant "+(index+1))?.closest(".relative.rounded-xl")||null;
  }
  function familyInput(card,label){
    if(!card)return null;
    const lbl=[...card.querySelectorAll("label")].find(l=>norm(l.textContent).replace(/\*/g,"").trim()===norm(label));
    return lbl?.parentElement?.querySelector("input,select")||null;
  }
  async function fillFamilyPerson(person,kind,index=0){
    const card=familyCard(kind,index);
    if(!card||!person)return;
    const civ=/^(mme|mlle|madame)$/i.test(clean(person.civilite))?"MME":/^(m|mr|monsieur)$/i.test(clean(person.civilite))?"M":"";
    const fields=[
      ["Civilité",civ],["Nom",person.nom],["Prénom",person.prenom],
      ["Date de naissance",normalizedDate(person.dateNaissance)],
      ["Lieu de naissance",person.lieuNaissance],
      ["Régime ASAF",/tns/i.test(person.regimeSocial)?"TNS":/agricole|msa/i.test(person.regimeSocial)?"AGR":/alsace|moselle/i.test(person.regimeSocial)?"ALS":"GENE"]
    ];
    for(const [label,value] of fields){
      const el=familyInput(card,label);
      if(!el||!value)continue;
      // For selects, the default first option is not a confirmed user value.
      if(el.tagName!=="SELECT"&&valueOf(el))continue;
      if(el.tagName==="SELECT"&&el.value===value)continue;
      setNative(el,value);
      await sleep(95);
    }
  }
  function highlightMissingFields(){
    const scope=document.querySelector("main");
    if(!scope)return;
    for(const label of scope.querySelectorAll("label")){
      const caption=norm(label.textContent).replace(/\*/g,"").trim();
      const el=label.parentElement?.querySelector("input,select,textarea");
      if(!el||!visible(el))continue;
      const isRequired=!!label.querySelector(".text-blue-600")||/\*/.test(label.textContent);
      // Do not flag optional passport fields or capital values chosen by the user.
      const isEmpty=!clean(el.value);
      const missing=isRequired&&isEmpty;
      el.classList.toggle("ltoa-k-missing",missing);
      label.classList.toggle("ltoa-k-label-missing",missing);
    }
  }
  async function fillStep3(payload){
    if(!await selectContractType(payload.typeContrat)){
      showPause("Type de contrat "+payload.typeContrat+" introuvable.");
      return false;
    }
    if(payload.typeContrat==="Famille"){
      if(!await createFamilyFields(payload)){
        showPause("Composition familiale introuvable.");
        return false;
      }
      if(payload.conjoint)await fillFamilyPerson(payload.conjoint,"conjoint");
      for(let i=0;i<payload.enfants.length;i++)await fillFamilyPerson(payload.enfants[i],"enfant",i);
    }
    const p=payload.principal;
    for(const [key,val] of [["Pays de rapatriement",p.paysRapatriement],["Pays de destination",p.paysRapatriement]])writeField(key,val);
    const response=norm(p.assure12Mois);
    if(response==="oui"||response==="non"){
      const radio=document.querySelector('main input[type="radio"][name="aAssuranceDerniers12Mois"][value="'+response+'"]');
      if(radio&&!radio.checked)radio.click();
      await sleep(120);
      if(radio&&!radio.checked)showPause("Assurance obsèques 12 mois : sélection non confirmée.");
    }
    highlightMissingFields();
    showPause("Données famille importées. Champs obligatoires encore vides en rouge : complétez-les et choisissez le capital obsèques. Aucune validation automatique.");
    return true;
  }
  async function advanceWizard(payload){
    if(wizardState.busy||wizardState.finished)return;
    wizardState.busy=true;
    try{
      const step=wizardStep();
      if(!step){showPause("Formulaire KOALAH en cours de chargement.");return;}
      wizardState.step=step;
      if(step===1)await fillStep1(payload.principal);
      if(step===2)fillStep2(payload.principal);
      if(step===3){
        const selected=await fillStep3(payload);
        if(selected){wizardState.finished=true;await GM_deleteValue(STORE);}
        return;
      }
      const missing=step===1?stepOneMissing():requiredMissing();
      if(missing.length){
        showPause("Étape "+step+" : renseigne "+missing.join(", ")+". La reprise est automatique après saisie.");
        return;
      }
      const next=nextButton();
      if(!next){showPause("Bouton Suivant introuvable à l'étape "+step+".");return;}
      if(Date.now()-wizardState.lastAction<1500)return;
      // Do not navigate away while the user is still typing (React fields update per keystroke).
      if(Date.now()-wizardState.lastUserInput<1600)return;
      const focused=document.activeElement;
      if(focused&&focused.matches("main input:not([type=hidden]),main textarea")&&Date.now()-wizardState.lastUserInput<3000)return;
      wizardState.lastAction=Date.now();
      showPause("Étape "+step+" complète : passage à la suite...");
      next.click();
    }catch(e){console.error("[LTOA Modulr → Koalah] assistant",e);showPause("Import suspendu : "+e.message);}
    finally{wizardState.busy=false;}
  }
  async function importIntoKoalah(payload){
    if(wizardState.started)return;
    wizardState.started=true;
    injectStyle();
    const banner=document.createElement("div");
    banner.id="ltoa-k-banner";
    banner.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px"><b>Import KOALAH</b><span id="ltoa-k-step">Étape 1 / 3</span></div><div style="height:5px;background:#e2e8f0;border-radius:6px;margin:8px 0;overflow:hidden"><div id="ltoa-k-progress" style="height:100%;width:0%;background:#2563eb;transition:width .35s"></div></div><div style="font-weight:600">'+esc(payload.principal.prenom)+" "+esc(payload.principal.nom)+'</div><span id="ltoa-k-missing-list"></span><span id="ltoa-k-status">Initialisation...</span>';
    document.body.appendChild(banner);
    let timer;
    const request=()=>{
      if(wizardState.finished)return;
      clearTimeout(timer);
      timer=setTimeout(()=>advanceWizard(payload),350);
    };
    const observer=new MutationObserver(request);
    observer.observe(document.querySelector("main")||document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["value","aria-pressed","disabled"]});
    document.addEventListener("input",e=>{if(e.isTrusted)wizardState.lastUserInput=Date.now();highlightMissingFields();request();},true);
    document.addEventListener("change",()=>{highlightMissingFields();request();},true);
    document.addEventListener("click",request,true);
    // Poll as a fallback when React only updates properties, or native date input
    // and button transitions do not emit the expected DOM mutations.
    const poll=setInterval(()=>{highlightMissingFields();if(wizardState.finished){clearInterval(poll);observer.disconnect();return;}advanceWizard(payload);},1800);
    request();
  }

  function koalahButton(label){
    const button=document.createElement("button");
    button.type="button";
    button.className="ltoa-k-row-btn";
    button.title="Exporter ce client vers KOALAH";
    button.innerHTML='<img alt="" src="https://plateforme.ltoa-assurances.fr/brand/koalah/koalah-mark.png"><span>'+label+'</span>';
    button.addEventListener("click",event=>{
      event.preventDefault();
      event.stopPropagation();
      openReview().catch(error=>console.error("[KOALAH] Export impossible",error));
    });
    return button;
  }
  function injectEstimateButtons(){
    if(!location.pathname.includes("/clients_card.php"))return;
    // ModulR mounts the Devis table in different wrappers depending on layout.
    const rows=document.querySelectorAll('tr[data-class_name="EstimateData"][data-entity_id]');
    for(const row of rows){
      if(row.querySelector(".ltoa-k-row-btn"))continue;
      const cells=row.querySelectorAll("td");
      if(cells.length<4||!norm(cells[2]?.textContent).includes("rapatriement"))continue;
      (row.querySelector("td.icons_cell")||cells[cells.length-1]).appendChild(koalahButton("KOALAH"));
    }
    // Guaranteed fallback on a client card even when Devis content isn't mounted yet.
    if(!document.getElementById("ltoa-k-fallback")){
      const b=koalahButton("Exporter vers KOALAH");
      b.id="ltoa-k-fallback";
      b.style.cssText="position:fixed!important;left:16px!important;bottom:16px!important;z-index:999990!important;padding:9px 12px!important;background:#f5f8fa!important;box-shadow:0 3px 14px #0002!important";
      document.body.appendChild(b);
    }
  }
  async function init(){
    if(location.hostname==="courtage.modulr.fr"){
      injectStyle();
      injectEstimateButtons();
      // Only monitor newly added estimate rows, not Aircall's controls.
      let timer;
      new MutationObserver(mutations=>{
        if(!mutations.some(m=>[...m.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('tr[data-class_name="EstimateData"]')||n.querySelector?.('tr[data-class_name="EstimateData"]')))))return;
        clearTimeout(timer);
        timer=setTimeout(injectEstimateButtons,150);
      }).observe(document.body,{childList:true,subtree:true});
      return;
    }
    if(location.hostname==="plateforme.ltoa-assurances.fr"){
      // Listen even on a normal authenticated KOALAH tab with no import URL.
      // This allows ModulR to hand off the job without opening /login.
      GM_addValueChangeListener(STORE,async(_key,_old,value,remote)=>{
        if(!remote||!value)return;
        let task;
        try{task=JSON.parse(value);}catch(_){return;}
        if(!task?.token||Date.now()-task.created>MAX_IMPORT_AGE)return;
        if(document.querySelector('input[type="password"]')||["/login","/connexion","/signin","/auth"].some(p=>location.pathname===p||location.pathname.startsWith(p+"/")))return;
        const ackKey=STORE+"_ack_"+task.token;
        if(await GM_getValue(ackKey,false))return;
        await GM_setValue(ackKey,true);
        if(location.pathname==="/clients/nouveau"){
          // Load the token in this existing tab; its authentication context stays intact.
          location.assign(KOALAH_NEW+"#"+encodeURIComponent(task.token));
        }else location.assign(KOALAH_NEW+"#"+encodeURIComponent(task.token));
      });
      const token=decodeURIComponent(location.hash.slice(1));
      // A normal KOALAH visit has no export token and must never start an import.
      if(!token.startsWith(TOKEN_PREFIX))return;
      // Hide the temporary token immediately; preserve current path/query.
      history.replaceState(history.state,"",location.pathname+location.search);
      let raw=await GM_getValue(STORE,"");
      // The new tab can load before Tampermonkey finishes storing the payload.
      for(let i=0;i<15&&!raw;i++){await sleep(200);raw=await GM_getValue(STORE,"");}
      if(!raw)return;
      let pending;
      try{pending=JSON.parse(raw);}catch(_){await GM_deleteValue(STORE);return;}
      if(!pending||pending.token!==token)return;
      if(Date.now()-pending.created>MAX_IMPORT_AGE){await GM_deleteValue(STORE);return;}
      // Authenticate normally if needed; never force the app away from its login screen.
      if(document.querySelector('input[type="password"]')||/\/(login|connexion|signin|auth)(\/|$)/i.test(location.pathname))return;
      if(location.pathname!=="/clients/nouveau"){
        location.replace(KOALAH_NEW);
        return;
      }
      try{
        await sleep(700);
        await importIntoKoalah(pending.payload);
      }catch(e){console.error("[LTOA Modulr → Koalah]",e);}
    }
  }
  init();
})();