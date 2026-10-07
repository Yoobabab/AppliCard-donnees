# AppliCard — données

Compléments à la base de cartes [TCGdex](https://tcgdex.dev) utilisés par l'appli AppliCard :
images de cartes et logos d'extensions manquants, cotes de secours, extensions à masquer.

Un robot (`outils/construire.mjs`, lancé chaque nuit par GitHub Actions) interroge
TCGdex, Limitless, TCGplayer (via TCGCSV), Pokémon TCG API et PokéAPI, vérifie que
chaque image existe, puis publie les fichiers du dossier `v1/` :

| Fichier | Contenu |
|---|---|
| `v1/{fr,en,de,es,it,ja}.json` | images de remplacement (par identifiant de carte), logos d'extensions, extensions exclues |
| `v1/cotes.json` | cotes de secours des cartes internationales (TCGplayer, converties en euros) |
| `v1/cotes-ja.json` | cotes de secours des cartes japonaises |
| `rapport.txt` | ce qui a été retrouvé et ce qui manque encore |

Le dépôt ne contient que des adresses d'images et des prix publics. Le code de l'appli est privé.

Pokémon et les noms associés sont des marques de Nintendo, Creatures et GAME FREAK.
Ce projet n'est ni affilié ni approuvé par The Pokémon Company.
