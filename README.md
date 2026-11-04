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

## Installation et mises à jour automatiques

[Installer ou mettre à jour le script dans Tampermonkey](https://raw.githubusercontent.com/BiggerThanTheMall/export_modulr_koalah/main/export_modulr_koalah.user.js).

La distribution nécessite que ce dépôt soit public. Tant qu'il reste privé, GitHub renvoie HTTP 404 aux vérifications sans authentification de Tampermonkey.

Les deux adresses d'origine sont conservées :

- `@updateURL https://raw.githubusercontent.com/BiggerThanTheMall/export_modulr_koalah/main/export_modulr_koalah.user.js`
- `@downloadURL https://raw.githubusercontent.com/BiggerThanTheMall/export_modulr_koalah/main/export_modulr_koalah.user.js`

Depuis la version 0.4.11, la mise à jour automatique est rétablie. Le nom et le namespace du script restent identiques pour mettre à jour l'installation existante.

Si la version 0.4.10 a déjà été installée, ouvrir une fois le lien d'installation ci-dessus après le passage du dépôt en public : cette version avait désactivé la vérification automatique. Les versions antérieures conservant les URL d'origine pourront vérifier la nouvelle version automatiquement.

## Version

`0.4.11`
