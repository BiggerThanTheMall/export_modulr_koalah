# Export Modulr → Koalah

Userscript Tampermonkey interne LTOA permettant de reprendre les informations d’une fiche client Modulr et de préparer la création du client dans Koalah sans double saisie.

## V1

- bouton **Exporter vers Koalah** sur une fiche client Modulr ;
- lecture du client principal ;
- détection des relations explicites **Conjoint** / **Enfant** dans les associations Modulr ;
- lecture des fiches liées ;
- fenêtre de contrôle avant export ;
- choix **Individuel** / **Famille** ;
- sélection des membres de la famille à reprendre ;
- transfert temporaire des données via le stockage Tampermonkey ;
- ouverture de Koalah sur `/clients/nouveau` ;
- tentative de remplissage automatique des champs trouvés ;
- validation finale Koalah laissée manuelle dans cette V1.

Koalah conserve sa logique native de tarification.

## Sécurité V1

`AUTO_SUBMIT = false`

On valide d’abord le mapping réel des champs du formulaire Koalah sur quelques dossiers avant d’activer un envoi automatique complet.

## Installation

Installer dans Tampermonkey :

`export_modulr_koalah.user.js`

## Mise à jour automatique

Le userscript contient déjà :

- `@updateURL`
- `@downloadURL`

pointant vers :

`https://raw.githubusercontent.com/BiggerThanTheMall/export_modulr_koalah/main/export_modulr_koalah.user.js`

### Attention dépôt privé

Le dépôt GitHub est privé. Une URL `raw.githubusercontent.com` privée n’est pas toujours exploitable par le mécanisme d’auto-update Tampermonkey sans authentification.

Si Tampermonkey renvoie `404` pendant la vérification de mise à jour, il faudra exposer uniquement le fichier `.user.js` via une URL interne stable ou un endpoint dédié accessible au navigateur, tout en laissant le dépôt privé.

## Version

`0.1.0`
