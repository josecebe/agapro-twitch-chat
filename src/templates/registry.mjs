export function createRegistry(defaultId) {
    const templates = new Map();
    const hookNames = new Set(['authorColor', 'styleBody', 'paintAuthor']);

    return Object.freeze({
        register(definition, hooks = {}) {
            const { id, name, presentation = {} } = definition;
            if (
                typeof id !== 'string' ||
                !/^[a-z][a-z0-9-]*$/.test(id) ||
                typeof name !== 'string' ||
                !name.trim()
            ) {
                throw Error('Invalid template identity');
            }
            if (templates.has(id)) throw Error('Duplicate template: ' + id);
            for (const [key, hook] of Object.entries(hooks)) {
                if (!hookNames.has(key) || typeof hook !== 'function') {
                    throw Error('Invalid presentation hook: ' + key);
                }
            }
            templates.set(
                id,
                Object.freeze({
                    id,
                    name,
                    glyphSpacing: presentation.glyphSpacing ?? true,
                    paintActionText: presentation.paintActionText ?? true,
                    ...hooks
                })
            );
        },
        get(id) {
            const template = templates.get(id) || templates.get(defaultId);
            if (!template) throw Error('Default template is not registered: ' + defaultId);
            return template;
        },
        list() {
            return [...templates.values()];
        }
    });
}
