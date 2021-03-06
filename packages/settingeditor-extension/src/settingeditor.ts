/*-----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import {
  Dialog, showDialog
} from '@jupyterlab/apputils';

import {
  CodeEditor, JSONEditor
} from '@jupyterlab/codeeditor';

import {
  ISettingRegistry, ObservableJSON
} from '@jupyterlab/coreutils';

import {
  Message
} from '@phosphor/messaging';

import {
  ISignal, Signal
} from '@phosphor/signaling';

import {
  h, VirtualDOM, VirtualElement
} from '@phosphor/virtualdom';

import {
  BoxLayout, SplitLayout, SplitPanel, Widget
} from '@phosphor/widgets';


/**
 * The class name added to all setting editors.
 */
const SETTING_EDITOR_CLASS = 'jp-SettingEditor';

/**
 * The class name added to all plugin editors.
 */
const PLUGIN_EDITOR_CLASS = 'jp-PluginEditor';

/**
 * The class name added to all plugin fieldsets.
 */
const PLUGIN_FIELDSET_CLASS = 'jp-PluginFieldset';

/**
 * The class name added to key labels in the fieldset.
 */
const KEY_LABEL_CLASS = 'jp-PluginFieldset-key';

/**
 * The class name added to all plugin lists.
 */
const PLUGIN_LIST_CLASS = 'jp-PluginList';

/**
 * The class name added to all plugin list icons.
 */
const PLUGIN_ICON_CLASS = 'jp-PluginList-icon';

/**
 * The class name added to selected items.
 */
const SELECTED_CLASS = 'jp-mod-selected';

/**
 * The class name added to the instructions widget.
 */
const INSTRUCTIONS_CLASS = 'jp-SettingEditorInstructions';

/**
 * The class name added to the instructions icon.
 */
const INSTRUCTIONS_ICON_CLASS = 'jp-SettingEditorInstructions-icon';

/**
 * The class name added to the instructions title.
 */
const INSTRUCTIONS_TITLE_CLASS = 'jp-SettingEditorInstructions-title';

/**
 * The class name added to the instructions text.
 */
const INSTRUCTIONS_TEXT_CLASS = 'jp-SettingEditorInstructions-text';

/**
 * The title of the instructions pane.
 */
const INSTRUCTIONS_TITLE = 'Settings';

/**
 * The instructions for using the setting editor.
 */
const INSTRUCTIONS_TEXT = `
Select a plugin from the list to view and edit its preferences.
`;

/**
 * An interface for modifying and saving application settings.
 */
export
class SettingEditor extends SplitPanel {
  /**
   * Create a new setting editor.
   */
  constructor(options: SettingEditor.IOptions) {
    super({
      orientation: 'horizontal',
      renderer: SplitPanel.defaultRenderer,
      spacing: 1
    });
    this.addClass(SETTING_EDITOR_CLASS);

    const editorFactory = options.editorFactory;
    const registry = this.registry = options.registry;
    const layout = this.layout as SplitLayout;

    this._editor = new PluginEditor({ editorFactory });
    this._instructions = new Widget({ node: Private.createInstructionsNode() });

    const confirm = () => this._editor.confirm();

    this._list = new PluginList({ confirm, registry });
    this._list.selected.connect(this._onSelected, this);

    layout.addWidget(this._list);
    layout.addWidget(this._instructions);
    layout.setRelativeSizes([1, 3]);
    registry.pluginChanged.connect(() => { this.update(); }, this);
  }

  /**
   * The setting registry modified by the editor.
   */
  readonly registry: ISettingRegistry;

  /**
   * Dispose of the resources held by the setting editor.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    super.dispose();
    this._editor.dispose();
    this._list.dispose();
  }

  /**
   * Handle `'activate-request'` messages.
   */
  protected onActivateRequest(msg: Message): void {
    this.node.tabIndex = -1;
    this.node.focus();
  }

  /**
   * Handle `'close-request'` messages.
   */
  protected onCloseRequest(msg: Message): void {
    this._editor.confirm().then(() => {
      super.onCloseRequest(msg);
      this.dispose();
    }).catch(() => { /* no op */ });
  }

  /**
   * Handle `'update-request'` messages.
   */
  protected onUpdateRequest(msg: Message): void {
    this._list.update();
    this._instructions.update();
    this._editor.update();
  }

  /**
   * Handle a new selection in the plugin list.
   */
  private _onSelected(sender: any, plugin: string): void {
    const layout = this.layout as SplitLayout;

    if (!plugin) {
      const sizes = this.relativeSizes();
      this._editor.settings = null;
      layout.removeWidget(this._editor);
      layout.addWidget(this._instructions);
      this.setRelativeSizes(sizes);
      return;
    }

    this.registry.load(plugin)
      .then(settings => {
        const sizes = this.relativeSizes();
        this._editor.settings = settings;
        layout.removeWidget(this._instructions);
        layout.addWidget(this._editor);
        this.setRelativeSizes(sizes);
      })
      .catch(reason => { console.error('Loading settings failed.', reason); });
  }

  private _editor: PluginEditor;
  private _instructions: Widget;
  private _list: PluginList;
}


/**
 * A namespace for `SettingEditor` statics.
 */
export
namespace SettingEditor {
  /**
   * The instantiation options for a setting editor.
   */
  export
  interface IOptions {
    /**
     * The editor factory used by the setting editor.
     */
    editorFactory: CodeEditor.Factory;

    /**
     * The setting registry the editor modifies.
     */
    registry: ISettingRegistry;
  }
}


/**
 * A list of plugins with editable settings.
 */
class PluginList extends Widget {
  /**
   * Create a new plugin list.
   */
  constructor(options: PluginList.IOptions) {
    super({ node: document.createElement('ul') });
    this.registry = options.registry;
    this.addClass(PLUGIN_LIST_CLASS);
    this._confirm = options.confirm;
  }

  /**
   * The setting registry.
   */
  readonly registry: ISettingRegistry;

  /**
   * A signal emitted when a selection is made from the plugin list.
   */
  get selected(): ISignal<this, string> {
    return this._selected;
  }

  /**
   * Handle the DOM events for the widget.
   *
   * @param event - The DOM event sent to the widget.
   *
   * #### Notes
   * This method implements the DOM `EventListener` interface and is
   * called in response to events on the dock panel's node. It should
   * not be called directly by user code.
   */
  handleEvent(event: Event): void {
    switch (event.type) {
    case 'click':
      this._evtClick(event as MouseEvent);
      break;
    default:
      break;
    }
  }

  /**
   * Reset the list selection.
   */
  reset(): void {
    this._selection = '';
    this._selected.emit('');
    this.update();
  }

  /**
   * Handle `'after-attach'` messages.
   */
  protected onAfterAttach(msg: Message): void {
    this.node.addEventListener('click', this);
  }

  /**
   * Handle `before-detach` messages for the widget.
   */
  protected onBeforeDetach(msg: Message): void {
    this.node.removeEventListener('click', this);
  }

  /**
   * Handle `'update-request'` messages.
   */
  protected onUpdateRequest(msg: Message): void {
    const annotations = this.registry.annotations;
    const plugins = Private.sortPlugins(this.registry.plugins);

    this.node.textContent = '';
    plugins.forEach(plugin => {
      const id = plugin.id;
      const item = Private.createListItem(plugin, annotations[id] || null);

      if (plugin.id === this._selection) {
        item.classList.add(SELECTED_CLASS);
      }

      this.node.appendChild(item);
    });
  }

  /**
   * Handle the `'click'` event for the plugin list.
   *
   * @param event - The DOM event sent to the widget
   */
  protected _evtClick(event: MouseEvent): void {
    let target = event.target as HTMLElement;
    let id = target.getAttribute('data-id');

    if (id === this._selection) {
      return;
    }

    if (!id) {
      while (!id && target !== this.node) {
        target = target.parentElement;
        id = target.getAttribute('data-id');
      }
    }

    if (id) {
      this._confirm().then(() => {
        this._selection = id;
        this._selected.emit(id);
        this.update();
      }).catch(() => { /* no op */ });
    }
  }

  private _confirm: () => Promise<void> | null = null;
  private _selected = new Signal<this, string>(this);
  private _selection = '';
}


/**
 * A namespace for `PluginList` statics.
 */
namespace PluginList {
  /**
   * The instantiation options for a plugin list.
   */
  export
  interface IOptions {
    /**
     * A function that allows for asynchronously confirming a selection.
     *
     * #### Notest
     * If the promise returned by the function resolves, then the selection will
     * succeed and emit an event. If the promise rejects, the selection is not
     * made.
     */
    confirm: () => Promise<void>;

    /**
     * The setting registry for the plugin list.
     */
    registry: ISettingRegistry;
  }
}


/**
 * An individual plugin settings editor.
 */
class PluginEditor extends Widget {
  /**
   * Create a new plugin editor.
   */
  constructor(options: PluginEditor.IOptions) {
    super();
    this.addClass(PLUGIN_EDITOR_CLASS);

    const { editorFactory } = options;
    const collapsible = false;
    const editor = this._editor = new JSONEditor({
      collapsible, editorFactory
    });
    const fieldset = this._fieldset = new PluginFieldset();
    const layout = this.layout = new BoxLayout({ direction: 'top-to-bottom' });

    layout.addWidget(editor);
    layout.addWidget(fieldset);
    BoxLayout.setStretch(editor, 5);
    BoxLayout.setStretch(fieldset, 2);
  }

  /**
   * The plugin settings being edited.
   */
  get settings(): ISettingRegistry.ISettings {
    return this._settings;
  }
  set settings(settings: ISettingRegistry.ISettings) {
    if (!settings && !this._settings) {
      return;
    }

    const samePlugin = (settings && this._settings) &&
      settings.plugin === this._settings.plugin;

    if (samePlugin) {
      return;
    }

    const fieldset = this._fieldset;
    const editor = this._editor;

    // Disconnect old source change handler.
    if (editor.source) {
      editor.source.changed.disconnect(this._onSourceChanged, this);
    }

    // Disconnect old settings change handler.
    if (this._settings) {
      this._settings.changed.disconnect(this._onSettingsChanged, this);
    }

    if (settings) {
      this._settings = fieldset.settings = settings;
      this._settings.changed.connect(this._onSettingsChanged, this);
      this._onSettingsChanged();

      editor.show();
      fieldset.show();
    } else {
      this._settings = fieldset.settings = null;
      editor.source = null;
      editor.hide();
      fieldset.hide();
    }

    this.update();
  }

  /**
   * If the editor is in a dirty state, confirm that the user wants to leave.
   */
  confirm(): Promise<void> {
    if (this.isHidden || !this.isAttached || !this._editor.isDirty) {
      return Promise.resolve(void 0);
    }

    return showDialog({
      title: 'You have unsaved changes.',
      body: 'Do you want to leave without saving?',
      buttons: [Dialog.cancelButton(), Dialog.okButton()]
    }).then(result => {
      if (!result.accept) {
        throw new Error();
      }
    });
  }

  /**
   * Handle `'update-request'` messages.
   */
  protected onUpdateRequest(msg: Message): void {
    const json = this._editor;
    const fieldset = this._fieldset;
    const settings = this._settings;

    if (settings) {
      json.show();
      fieldset.show();
      json.editor.refresh();
      return;
    }

    json.hide();
    fieldset.hide();
  }

  /**
   * Handle updates to the settings.
   */
  private _onSettingsChanged(): void {
    const editor = this._editor;
    const settings = this._settings;
    const values = settings.raw.data && settings.raw.data.user || { };

    editor.source = new ObservableJSON({ values });
    editor.source.changed.connect(this._onSourceChanged, this);
  }

  /**
   * Handle source changes in the underlying editor.
   */
  private _onSourceChanged(): void {
    const editor = this._editor;
    const settings = this._settings;
    const id = settings.plugin;
    const data = { user: editor.source.toJSON() };

    settings.save({ id, data });
  }

  private _editor: JSONEditor = null;
  private _fieldset: PluginFieldset = null;
  private _settings: ISettingRegistry.ISettings | null = null;
}


/**
 * A namespace for `PluginEditor` statics.
 */
namespace PluginEditor {
  /**
   * The instantiation options for a plugin editor.
   */
  export
  interface IOptions {
    /**
     * The editor factory used by the plugin editor.
     */
    editorFactory: CodeEditor.Factory;
  }
}


/**
 * An individual plugin settings fieldset.
 */
class PluginFieldset extends Widget {
  /**
   * Create a new plugin fieldset.
   */
  constructor() {
    super({ node: document.createElement('fieldset') });
    this.addClass(PLUGIN_FIELDSET_CLASS);
  }

  /**
   * The plugin settings.
   */
  get settings(): ISettingRegistry.ISettings {
    return this._settings;
  }
  set settings(settings: ISettingRegistry.ISettings) {
    this._settings = settings;
    this.update();
  }

  /**
   * Handle `'update-request'` messages.
   */
  protected onUpdateRequest(msg: Message): void {
    // Empty the node.
    this.node.textContent = '';

    if (!this._settings) {
      return;
    }

    const settings = this._settings;

    Private.populateFieldset(this.node, settings.raw, settings.annotations);
  }

  private _settings: ISettingRegistry.ISettings | null = null;
}


/**
 * A namespace for private module data.
 */
namespace Private {
  /**
   */
  export
  function createInstructionsNode(): HTMLElement {
    return VirtualDOM.realize(h.div({ className: INSTRUCTIONS_CLASS },
      h.h2(
        h.span({ className: `${INSTRUCTIONS_ICON_CLASS} jp-JupyterIcon` }),
        h.span({ className: INSTRUCTIONS_TITLE_CLASS }, INSTRUCTIONS_TITLE)),
      h.span({ className: INSTRUCTIONS_TEXT_CLASS }, INSTRUCTIONS_TEXT)));
  }

  /**
   * Create a plugin list item.
   */
  export
  function createListItem(plugin: ISettingRegistry.IPlugin, annotations: ISettingRegistry.IPluginAnnotations): HTMLLIElement {
    const annotation = annotations && annotations.annotation;
    const caption = annotation && annotation.caption || plugin.id;
    const className = annotation && annotation.className || '';
    const iconClass = `${PLUGIN_ICON_CLASS} ${
      annotation && annotation.iconClass || ''
    }`;
    const iconLabel = annotation && annotation.iconLabel || '';
    const label = (annotation && annotation.label) || plugin.id;

    return VirtualDOM.realize(
      h.li({ className, dataset: { id: plugin.id }, title: caption },
        h.span({ className: iconClass, title: iconLabel }),
        h.span(label))
    ) as HTMLLIElement;
  }

  /**
   * Populate the fieldset with a specific plugin's annotation.
   */
  export
  function populateFieldset(node: HTMLElement, plugin: ISettingRegistry.IPlugin, annotations: ISettingRegistry.IPluginAnnotations): void {
    const label = annotations && annotations.annotation &&
      `Available Fields - ${annotations.annotation.label}` ||
      `Available Fields - ${plugin.id}`;
    const fields: { [key: string]: VirtualElement } = Object.create(null);

    Object.keys(annotations && annotations.keys || { }).forEach(key => {
      const annotation = annotations.keys[key];
      const label = annotation.label ? `(${annotation.label})` : '';

      fields[key] = h.li(
        h.code(key),
        h.span({ className: KEY_LABEL_CLASS }, label));
    });
    Object.keys(plugin.data.system || { }).forEach(key => {
      if (!fields[key]) {
        fields[key] = h.li(h.code(key));
      }
    });
    Object.keys(plugin.data.user || { }).forEach(key => {
      if (!fields[key]) {
        fields[key] = h.li(h.code(key));
      }
    });

    const items: VirtualElement[] = Object.keys(fields)
      .sort((a, b) => a.localeCompare(b)).map(key => fields[key]);

    node.appendChild(VirtualDOM.realize(h.legend({ title: plugin.id }, label)));
    node.appendChild(VirtualDOM.realize(h.ul(items)));
  }

  /**
   * Sort a list of plugins by ID.
   */
  export
  function sortPlugins(plugins: ISettingRegistry.IPlugin[]): ISettingRegistry.IPlugin[] {
    return plugins.sort((a, b) => a.id.localeCompare(b.id));
  }
}
