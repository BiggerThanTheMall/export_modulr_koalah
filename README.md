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

## Installation et mises à jour

Le dépôt est privé. Les anciennes URL brutes renvoient HTTP 404 sans authentification et ne permettent pas une mise à jour automatique fiable dans Tampermonkey.

1. Se connecter à GitHub avec un compte autorisé sur ce dépôt.
2. Ouvrir [export_modulr_koalah.user.js](https://github.com/BiggerThanTheMall/export_modulr_koalah/blob/main/export_modulr_koalah.user.js) et copier tout son contenu.
3. Dans Tampermonkey, ouvrir le script KOALAH existant, ou créer un nouveau script pour une première installation.
4. Remplacer tout le contenu et enregistrer avec `Ctrl + S`.
5. Recharger Modulr et Koalah.

Depuis la version 0.4.10, `@updateURL none` désactive les vérifications automatiques vers l'adresse privée qui renvoyait 404. Les mises à jour restent manuelles tant qu'une adresse de distribution stable et accessible à Tampermonkey n'est pas configurée. Aucun jeton GitHub ne doit être ajouté aux URL du script.

## Version

`0.4.10`
