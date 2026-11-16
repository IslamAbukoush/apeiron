# Monk caretaker

The courtyard and all six generated themes use the same textured monk asset at
`public/models/monk/`. Its 1.8-unit height, ground alignment, facing and fixed
collision proxy match the shared NPC controller. Interaction raycasts still find
the caretaker through the imported mesh's parent.

The archive contains a static mesh, no animation clips or usable skin weights.
`src/game/npc-avatar.ts` supplies procedural idle breathing/head movement, relaxed
arms, walking robe/arm sway, smooth visual turns, a jump pose and a seated robe
pose. These are lightweight mesh deformations, not imported skeletal animations
or motion capture. NPC logic and collider movement remain independent.

Each world owns its render resources. Disposal releases geometry, material and
texture resources, including assets that finish loading after the world closes.
No remote asset service is required. The original zip is preserved.

Based on [Monk Character](https://sketchfab.com/3d-models/monk-character-8cacbd85a5b84f59a8c9000d7a6dcca2)
by [Inuciian](https://sketchfab.com/Inuciian), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The supplied license is
preserved beside the asset and attribution is available in the pause menu.
