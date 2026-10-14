import Plugin from '@jbrowse/core/Plugin';
import { ConfigurationSchema } from '@jbrowse/core/configuration';
import AdapterType from '@jbrowse/core/pluggableElementTypes/AdapterType';
import WidgetType from '@jbrowse/core/pluggableElementTypes/WidgetType';
import { getSession, isAbstractMenuManager } from '@jbrowse/core/util';
import { SvgIcon } from '@mui/material';
import ScanChunk from './jbrowse/ScanChunk.js';
import { ADAPTER_TYPE, ResultsAdapter, adapterConfigSchema } from './jbrowse/ResultsAdapter.js';
import { WIDGET_TYPE, openSearchWidget } from './jbrowse/session.js';
import stateModelFactory from './widget/model.js';
import SearchWidget from './widget/SearchWidget.jsx';

export const PLUGIN_NAME = 'GenomeSequenceSearch';
export const COMMAND_LABEL = 'Search genome…';

// Material Design "search" glyph (Apache License 2.0).
function SearchGenomeIcon(props) {
  return (
    <SvgIcon {...props}>
      <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14" />
    </SvgIcon>
  );
}

export default class GenomeSequenceSearchPlugin extends Plugin {
  name = PLUGIN_NAME;

  version = __PLUGIN_VERSION__;

  install(pluginManager) {
    pluginManager.addRpcMethod(pm => new ScanChunk(pm));

    pluginManager.addAdapterType(() => new AdapterType({
      name: ADAPTER_TYPE,
      displayName: 'Genome search results',
      configSchema: adapterConfigSchema,
      AdapterClass: ResultsAdapter,
      adapterMetadata: { hiddenFromGUI: true },
    }));

    pluginManager.addWidgetType(() => new WidgetType({
      name: WIDGET_TYPE,
      heading: 'Search genome',
      configSchema: ConfigurationSchema(WIDGET_TYPE, {}),
      stateModel: stateModelFactory(pluginManager),
      ReactComponent: SearchWidget,
    }));

    // Add the command to each Linear Genome View's menu, next to the
    // built-in "Sequence search" when present.
    pluginManager.addToExtensionPoint('Core-extendPluggableElement', element => {
      if (element.name === 'LinearGenomeView' && element.stateModel) {
        element.stateModel = element.stateModel.extend(self => {
          const superMenuItems = self.menuItems;
          return {
            views: {
              menuItems() {
                const items = superMenuItems();
                if (!items.length) return items;
                const item = {
                  label: COMMAND_LABEL,
                  subLabel: 'Whole assembly, with a results list',
                  icon: SearchGenomeIcon,
                  onClick: () => openSearchWidget(getSession(self), self),
                };
                const at = items.findIndex(i => i.label === 'Sequence search');
                return at === -1 ? [...items, item] : [...items.slice(0, at + 1), item, ...items.slice(at + 1)];
              },
            },
          };
        });
      }
      return element;
    });
  }

  configure(pluginManager) {
    // The RPC worker runs configure() too, without a root model or menus.
    if (isAbstractMenuManager(pluginManager.rootModel)) {
      pluginManager.rootModel.appendToMenu('Tools', {
        label: COMMAND_LABEL,
        icon: SearchGenomeIcon,
        onClick: session => openSearchWidget(session),
      });
    }
  }
}
