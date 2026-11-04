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

Le dépôt est public. Le lien a été vérifié sans authentification le 4 novembre 2026 : HTTP 200, version 0.4.11.

Les deux adresses d'origine sont conservées :

- `@updateURL https://raw.githubusercontent.com/BiggerThanTheMall/export_modulr_koalah/main/export_modulr_koalah.user.js`
- `@downloadURL https://raw.githubusercontent.com/BiggerThanTheMall/export_modulr_koalah/main/export_modulr_koalah.user.js`

Depuis la version 0.4.11, la mise à jour automatique est rétablie. Le nom et le namespace du script restent identiques pour mettre à jour l'installation existante.

Si la version 0.4.10 a déjà été installée, ouvrir une fois le lien d'installation ci-dessus après le passage du dépôt en public : cette version avait désactivé la vérification automatique. Les versions antérieures conservant les URL d'origine pourront vérifier la nouvelle version automatiquement.

## Version

`0.4.11`

<!-- LTOA-INSTALLATION-START -->
## Liens d'installation et de mise à jour

Liens publics vérifiés sans connexion GitHub le 4 novembre 2026. Partager le lien « Installer » du script souhaité.

| Fichier | Version | Installation / `@downloadURL` | `@updateURL` |
|---|---|---|---|
| `export_modulr_koalah.user.js` | 0.4.11 | [Installer](https://raw.githubusercontent.com/BiggerThanTheMall/export_modulr_koalah/main/export_modulr_koalah.user.js) | [Vérifier la version](https://raw.githubusercontent.com/BiggerThanTheMall/export_modulr_koalah/main/export_modulr_koalah.user.js) |

### Si le lien affiche du code au lieu d'ouvrir l'installation

Dans Tampermonkey : **Tableau de bord → Utilitaires → Importer depuis une URL**. Coller le lien « Installer » ci-dessus, lancer l'import puis confirmer l'installation ou la mise à jour. Cette méthode permet l'import même si le navigateur ne reconnaît pas automatiquement un lien `.user.js`.

### Mises à jour automatiques

Les adresses indiquées sont présentes dans l'en-tête des fichiers et restent fixes. Dans les paramètres Tampermonkey, activer les vérifications de mise à jour et choisir une fréquence régulière. Vérifier aussi que la recherche de mises à jour est autorisée pour le script concerné. Une vérification manuelle permet de tester sans attendre la prochaine vérification planifiée.

Une modification du code sur GitHub doit être accompagnée d'une augmentation de `@version` pour être reconnue comme une nouvelle version. Un commit seul ne suffit pas. Si une installation conserve une ancienne adresse, importer une fois le lien actuel dans le script existant. Ne pas supprimer le script pour conserver ses réglages.

Documentation officielle : [import depuis une URL](https://www.tampermonkey.net/faq.php?q=Q106), [version du script](https://www.tampermonkey.net/documentation.php?q=version), [adresses de mise à jour](https://www.tampermonkey.net/documentation.php?q=update_url).
<!-- LTOA-INSTALLATION-END -->
