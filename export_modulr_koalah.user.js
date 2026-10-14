// ==UserScript==
// @name         LTOA - Export Modulr vers Koalah
// @namespace    https://ltoa-assurances.fr/
// @version      0.2.1
// @description  Export d'une fiche client Modulr vers Koalah avec contrôle Individuel/Famille.
// @match        https://courtage.modulr.fr/fr/scripts/clients/clients_card.php*
// @match        https://plateforme.ltoa-assurances.fr/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @updateURL    https://raw.githubusercontent.com/BiggerThanTheMall/export_modulr_koalah/main/export_modulr_koalah.user.js
// @downloadURL  https://raw.githubusercontent.com/BiggerThanTheMall/export_modulr_koalah/main/export_modulr_koalah.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  const STORE = "ltoa_modulr_koalah_pending_v1";
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
      dateNaissance:valueByLabel(doc,"Date de naissance"),
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
  function askMissing(promptLabel,defaultValue=""){
    const answer=window.prompt(promptLabel,defaultValue);
    return answer===null?null:clean(answer);
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
    s.textContent="#ltoa-k-btn{position:fixed;right:22px;bottom:22px;z-index:999990;background:#215c7f;color:#fff;border:0;border-radius:8px;padding:12px 16px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px #0003}#ltoa-k-overlay{position:fixed;inset:0;z-index:999999;background:#0008;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif}#ltoa-k-modal{width:min(820px,94vw);max-height:90vh;overflow:auto;background:#fff;border-radius:12px;padding:22px;color:#1d2730;box-shadow:0 20px 70px #0006}.ltoa-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;background:#f4f7f9;padding:14px;border-radius:8px}.ltoa-person{border:1px solid #d9e0e5;border-radius:8px;padding:10px;margin:8px 0}.ltoa-warn{color:#9b5b00;font-weight:700}.ltoa-ok{color:#19703d;font-weight:700}.ltoa-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.ltoa-actions button{border:0;border-radius:7px;padding:10px 14px;cursor:pointer}.ltoa-primary{background:#215c7f;color:#fff;font-weight:700}#ltoa-k-banner{position:fixed;left:20px;right:20px;top:18px;z-index:999999;background:#fff;border:2px solid #215c7f;border-radius:10px;padding:14px 16px;box-shadow:0 6px 24px #0003;font-family:Arial,sans-serif}";
    document.head.appendChild(s);
  }

  async function openReview() {
    const principal=parsePerson(document), links=familyLinks(document);
    const fromDescription=inferFromDescription(descriptions(document));
    principal.paysRapatriement=fromDescription.paysRapatriement;
    principal.assure12Mois=fromDescription.assure12Mois;
    principal.regimeSocialKoalah=regimeFromModulr(principal.regimeSocial);
    const btn=document.getElementById("ltoa-k-btn");
    btn.disabled=true; btn.textContent="Analyse famille...";
    const family=await Promise.all(links.map(loadRelative));
    btn.disabled=false; btn.textContent="Exporter vers Koalah";

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
    overlay.innerHTML='<div id="ltoa-k-modal"><h2>Export Modulr → Koalah</h2><h3>Client principal</h3><div class="ltoa-grid"><div><b>Identité</b><br>'+esc(principal.civilite)+' '+esc(principal.prenom)+' '+esc(principal.nom)+'</div><div><b>Naissance</b><br>'+esc(principal.dateNaissance||"Non renseignée")+' '+esc(principal.lieuNaissance||"")+'</div><div><b>Coordonnées</b><br>'+esc(principal.telephone||"—")+'<br>'+esc(principal.email||"—")+'</div><div><b>Adresse</b><br>'+esc(principal.adresse||"—")+'<br>'+esc(principal.codePostal)+' '+esc(principal.ville)+'</div></div><h3>Type Koalah</h3><label style="margin-right:24px"><input type="radio" name="ltoa-type" value="Individuel" '+(family.length?"":"checked")+'> Individuel</label><label><input type="radio" name="ltoa-type" value="Famille" '+(family.length?"checked":"")+'> Famille</label><div id="ltoa-family"><h3>Famille détectée dans Modulr</h3>'+familyHtml+'</div><p class="ltoa-warn">Les champs spécifiques au devis Koalah absents de Modulr resteront à vérifier dans Koalah.</p><div class="ltoa-actions"><button id="ltoa-cancel">Annuler</button><button id="ltoa-send" class="ltoa-primary">Continuer vers Koalah</button></div></div>';
    document.body.appendChild(overlay);

    const refresh=()=>{ const type=overlay.querySelector('input[name="ltoa-type"]:checked').value; overlay.querySelector("#ltoa-family").style.display=type==="Famille"?"block":"none"; };
    overlay.querySelectorAll('input[name="ltoa-type"]').forEach(r=>r.addEventListener("change",refresh)); refresh();
    overlay.querySelector("#ltoa-cancel").onclick=()=>overlay.remove();
    overlay.querySelector("#ltoa-send").onclick=async()=>{
      const typeContrat=overlay.querySelector('input[name="ltoa-type"]:checked').value;
      if(!principal.paysRapatriement){
        const answer=askMissing("Pays de rapatriement : non identifié dans les descriptions ModulR. Indique le pays (ou laisse vide pour compléter sur KOALAH).");
        if(answer===null)return;
        principal.paysRapatriement=answer;
      }
      if(!principal.assure12Mois){
        const answer=askMissing("Assuré durant les 12 derniers mois ? Indique Oui ou Non (ou laisse vide pour répondre sur KOALAH).");
        if(answer===null)return;
        principal.assure12Mois=/^oui$/i.test(answer)?"Oui":/^non$/i.test(answer)?"Non":"";
      }
      let selected=[];
      if(typeContrat==="Famille") selected=[...overlay.querySelectorAll(".ltoa-member:checked")].map(x=>family[Number(x.dataset.i)]);
      const payload={source:{modulrClientId:principal.modulrId,url:location.href},typeContrat,principal,conjoint:selected.find(x=>x.relation==="Conjoint")||null,enfants:selected.filter(x=>x.relation==="Enfant")};
      await GM_setValue(STORE,JSON.stringify(payload));
      window.open(KOALAH_NEW,"_blank");
      overlay.remove();
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
      el.value=opt.value;
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
  const wizardState={busy:false,step:0,finished:false,started:false,lastAction:0};
  const visible=(el)=>!!el&&el.getClientRects().length>0&&!el.disabled;
  function field(label){
    const wanted=norm(label);
    for(const l of document.querySelectorAll("label")){
      if(!visible(l)||norm(l.textContent).replace(/\*/g,"").trim()!==wanted)continue;
      const target=l.htmlFor&&document.getElementById(l.htmlFor);
      if(target&&visible(target))return target;
      const parent=l.parentElement;
      const el=parent?.querySelector("input,select,textarea,[role=combobox]");
      if(el&&visible(el))return el;
    }
    return null;
  }
  function normalizedDate(value){
    const v=clean(value);
    const m=v.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
    return m?m[3]+"-"+m[2]+"-"+m[1]:v;
  }
  function valueOf(el){
    if(!el)return "";
    if(el.matches("input[type=checkbox],input[type=radio]"))return el.checked?el.value:"";
    return clean(el.value||el.textContent||"");
  }
  function writeField(label,value){
    const el=field(label);
    if(!el||!value)return false;
    if(valueOf(el))return true; // Never overwrite manual corrections.
    return setNative(el,el.type==="date"?normalizedDate(value):value);
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
  }
  function fillStep1(p){
    selectedCivilite(p.civilite);
    writeField("Nom",p.nom);
    writeField("Prénom",p.prenom);
    writeField("Date de naissance",p.dateNaissance);
    writeField("Lieu de naissance",p.lieuNaissance);
  }
  function fillStep2(p){
    const pairs=[
      ["Email",p.email],["E-mail",p.email],
      ["Téléphone",p.telephone],["Adresse",p.adresse],
      ["Code postal",p.codePostal],["Ville",p.ville],
      ["Situation familiale",p.situationFamiliale],
      ["Situation matrimoniale",p.situationFamiliale],
      ["Régime social",p.regimeSocialKoalah],
      ["Régime de sécurité sociale",p.regimeSocialKoalah],
      ["Régime obligatoire",p.regimeSocialKoalah]
    ];
    for(const [key,val] of pairs)writeField(key,val);
    // Sécurité sociale par défaut à tout âge ; exception explicite ModulR.
  }
  function fillStep3(payload){
    // Step 3 is deliberately non-submitting. The client chooses funeral capital.
    clickChoiceByText(document,payload.typeContrat);
    const p=payload.principal;
    for(const [key,val] of [
      ["Pays de rapatriement",p.paysRapatriement],
      ["Pays de destination",p.paysRapatriement],
      ["Assuré au cours des 12 derniers mois",p.assure12Mois],
      ["Assuré les 12 derniers mois",p.assure12Mois]
    ])writeField(key,val);
    if(payload.typeContrat==="Famille"){
      if(payload.conjoint)fillPerson(payload.conjoint,"conjoint.",section(/conjoint/i)||document);
      payload.enfants.forEach((child,i)=>fillPerson(child,"enfants["+i+"].",section(new RegExp("enfant\\s*"+(i+1),"i"))||document));
    }
    showPause("Étape 3 atteinte : vérifie les données, le pays et les membres de la famille, puis choisis manuellement le capital obsèques. Aucune validation automatique.");
  }
  async function advanceWizard(payload){
    if(wizardState.busy||wizardState.finished)return;
    wizardState.busy=true;
    try{
      const step=wizardStep();
      if(!step){showPause("Formulaire KOALAH en cours de chargement.");return;}
      wizardState.step=step;
      if(step===1)fillStep1(payload.principal);
      if(step===2)fillStep2(payload.principal);
      if(step===3){
        fillStep3(payload);
        wizardState.finished=true;
        await GM_deleteValue(STORE);
        return;
      }
      const missing=requiredMissing();
      if(missing.length){
        showPause("Étape "+step+" : renseigne "+missing.join(", ")+". La reprise est automatique après saisie.");
        return;
      }
      const next=nextButton();
      if(!next){showPause("Bouton Suivant introuvable à l'étape "+step+".");return;}
      if(Date.now()-wizardState.lastAction<1200)return;
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
    banner.innerHTML="<b>Import Modulr → KOALAH</b> — "+esc(payload.principal.prenom)+" "+esc(payload.principal.nom)+" · "+esc(payload.typeContrat)+'<br><span id="ltoa-k-status">Initialisation des étapes...</span>';
    document.body.appendChild(banner);
    let timer;
    const request=()=>{
      if(wizardState.finished)return;
      clearTimeout(timer);
      timer=setTimeout(()=>advanceWizard(payload),350);
    };
    const observer=new MutationObserver(request);
    observer.observe(document.querySelector("main")||document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["value","aria-pressed","disabled"]});
    document.addEventListener("input",request,true);
    document.addEventListener("change",request,true);
    document.addEventListener("click",request,true);
    request();
  }

  async function init(){
    if(location.hostname==="courtage.modulr.fr"){
      injectStyle();
      const b=document.createElement("button");
      b.id="ltoa-k-btn"; b.textContent="Exporter vers Koalah"; b.onclick=openReview; document.body.appendChild(b); return;
    }
    if(location.hostname==="plateforme.ltoa-assurances.fr"){
      const raw=await GM_getValue(STORE,""); 
      if(!raw) return;

      // Si Koalah impose une authentification, on conserve l'import en attente.
      // Une fois connecté, dès qu'une page authentifiée est atteinte, on revient automatiquement
      // sur /clients/nouveau pour reprendre l'import.
      const isLoginPage =
        !!document.querySelector('input[type="password"]') ||
        /\/(login|connexion|signin|auth)(\/|$)/i.test(location.pathname);

      if(isLoginPage) {
        console.info("[LTOA Modulr → Koalah] Authentification Koalah requise. Import conservé en attente.");
        return;
      }

      if(!location.pathname.startsWith("/clients/nouveau")){
        location.replace(KOALAH_NEW);
        return;
      }

      try{
        await sleep(700);
        await importIntoKoalah(JSON.parse(raw));
      }catch(e){
        console.error("[LTOA Modulr → Koalah]",e);
      }
    }
  }
  init();
})();