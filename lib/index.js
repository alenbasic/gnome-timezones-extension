'use strict';
import timezones from './timezones';

const {GLib, St, Clutter, GnomeDesktop, Gio } = imports.gi;
const { main, panelMenu, popupMenu } = imports.ui;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

let Clock = {
  config: {
    format24: true,
    showCity: true,
    showTimezone: false
  },
  enable: function () {

    // Clock.state is a list of objects that have the below characteristics

    Clock.state = timezones.sort().map(item => {
      return {
        timezone: item,
        lowerTimezone: item.toLowerCase(),
        active: item === 'UTC'
      };
    });

    Clock.schema = Gio.SettingsSchemaSource.new_from_directory(
      Me.dir.get_child('schemas').get_path(),
      Gio.SettingsSchemaSource.get_default(),
      false
    );
    Clock.settings = new Gio.Settings({
      settings_schema: Clock.schema.lookup('org.gnome.shell.extensions.timezones', true)
    });

    Clock.loadSettings();

    let button = new panelMenu.Button(0.50, Me.metadata.name);
    button.set_y_align(Clutter.ActorAlign.CENTER);

    let label = new St.Label({
      text: '...',
      opacity: 150
    });
    button.actor.add_child(label);

    Clock.button = button;
    Clock.label = label;

    Clock.initMenu();
    Clock.updateLabel();

    Clock.SystemClock = new GnomeDesktop.WallClock();
    Clock.signalId = Clock.SystemClock.connect('notify::clock', Clock.updateLabel);

    main.panel.addToStatusArea(`${Me.metadata.name} Indicator`, Clock.button, 1, 'center');
  },
  disable: function () {
    Clock.SystemClock.disconnect(Clock.signalId);
    Clock.button.destroy();
    Clock.saveSettings();
  },
  loadSettings: function () {
    let timezones = Clock.settings.get_value('timezones');
    let timezonesArray = timezones.deep_unpack();
    if (timezonesArray.length > 0) {
      Clock.state.forEach(item => {
        item.active = timezonesArray.indexOf(item.timezone) !== -1;
      });
    }

    let config = Clock.settings.get_value('config');
    let configObj = config.deep_unpack();
    if (Object.keys(configObj).length > 0) {
      for (let key in configObj) {
        Clock.config[key] = configObj[key];
      }
    }
  },
  saveSettings: function () {
    Clock.settings.set_value(
      'timezones',
      new GLib.Variant('as', Clock.state.filter(item => item.active).map(item => item.timezone))
    );

    Clock.settings.set_value('config', new GLib.Variant('a{sb}', Clock.config));
  },

  // creates the actual menu that the user interacts with

  initMenu: function () {
    Clock.menu = Clock.button.menu;
    Clock.activeMenu = Clock.createScrollableMenuSection();
    Clock.inactiveMenu = Clock.createScrollableMenuSection();
    Clock.configMenu = Clock.createScrollableMenuSection();
    Clock.configMenu.itemActivated = () => {};

    Clock.addConfigSwitch({label: '24 hours format', name: 'format24'});
    Clock.addConfigSwitch({label: 'Show city name', name: 'showCity'});
    Clock.addConfigSwitch({label: 'Show timezone', name: 'showTimezone'});

    // creates the bind for the input field so that it filters out
    // timezones that don't match the user input

    let inputFilter = new St.Entry({ width: 300, can_focus: true });
    inputFilter.clutter_text.connect('text-changed', (o) => {
      Clock.hint = o.get_text().toLowerCase();
      Clock.updateInactiveMenu();
    });

    let inputFilterItem = new popupMenu.PopupBaseMenuItem({reactive: false});
    inputFilterItem.actor.add_child(inputFilter);

    Clock.menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem('Active clocks'));
    Clock.menu.addMenuItem(Clock.activeMenu);
    Clock.menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem('Add more clocks'));
    Clock.menu.addMenuItem(inputFilterItem);
    Clock.menu.addMenuItem(Clock.inactiveMenu);
    Clock.menu.addMenuItem(new popupMenu.PopupSeparatorMenuItem('Config'));
    Clock.menu.addMenuItem(Clock.configMenu);

    // bind that's run whenever the user opens the menu to say change a setting
    // or add/remove a timezone

    Clock.menu.connect('open-state-changed', (menu, open) => {
      if (open) {
        inputFilter.set_text('');
        Clock.hint = '';
        Clock.updateMenu();
      }
    });
  },

  // this is for the toggles at the bottom of the menu; e.g. 24 hours format / Show timezone

  addConfigSwitch: function ({label, name}) {
    let configSwitch = new popupMenu.PopupSwitchMenuItem(label, Clock.config[name]);
    configSwitch.connect('toggled', (event, state) => {
      Clock.config[name] = state;
      Clock.saveSettings();
      Clock.updateLabel();
    });
    Clock.configMenu.addMenuItem(configSwitch);
  },

  // this creates the 3 main areas: the active/inactive timezones and the config area

  createScrollableMenuSection: function () {
    let menu = new popupMenu.PopupMenuSection();
    menu.actor = new St.ScrollView({
      style_class: 'popup-menu-content',
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC
    });
    menu.actor.add_actor(menu.box);
    return menu;
  },

  // so the the timezones aren't separate items but rather a single label
  // this label is generated by going through each time zone and concatenating it
  // to the string if it's marked as active

  updateLabel: function () {
    let text = '';
    Clock.state.forEach(item => text += item.active ? `    ${Clock.getLabelForTimezone({item: item})}` : '');
    text = text.trim();

    if (text.length === 0) {
      text = '...';
    }

    Clock.label.text = text;
  },

  // generates the label for a timezone; e.g. Africa/Abidjan GMT 1.30 PM

  getLabelForTimezone: function ({item, full}) {
    let glibTimezone = GLib.TimeZone.new(item.timezone);
    let now = GLib.DateTime.new_now(glibTimezone);
    let timezoneLabel = full ? item.timezone : Clock.config.showCity ? item.timezone.split('/').pop().replace('_', ' ') : '';
    let offset = full || Clock.config.showTimezone ? ` ${now.format('%Z')} ` : ' ';
    return `${timezoneLabel}${offset}${now.format(Clock.config.format24 ? '%R' : '%l:%M %p')}`;
  },
  

  updateMenu: function () {
    Clock.updateTimeLabels();
    Clock.updateActiveMenu();
    Clock.updateInactiveMenu();
  },


  updateTimeLabels: function () {
    Clock.state.forEach(item => item.label = Clock.getLabelForTimezone({item: item, full: true}));
  },

  
  updateActiveMenu: function () {
    let active = String.fromCodePoint(parseInt('2714', 16)); // gets the tick symbol
    Clock.activeMenu.removeAll();

    // gets the list of timezones, filters out any that aren't active and then binds
    // the toggleTimezone function to each timezonee so whenever a user clicks on one
    // that function is triggered

    Clock.state.filter(item => item.active).forEach(item => Clock.activeMenu.addAction(
      `${active} ${item.label}`, // displays the the timezone prepended with a tick 
      () => Clock.toggleTimezone(item))
    );
  },
  updateInactiveMenu: function () {
    Clock.inactiveMenu.removeAll();
    Clock.state
      .filter(item => !item.active && item.lowerTimezone.indexOf(Clock.hint) !== -1)
      .forEach(item => Clock.inactiveMenu.addAction(
        item.label,
        () => Clock.toggleTimezone(item))
      );
  },

  // this is attached to a timezone so when a user clicks on it
  // it will change the active flag and rerender the timezone menu

  toggleTimezone: function (item) {
    item.active = !item.active;
    Clock.updateLabel();
    Clock.saveSettings();
  }
};


function init() {
  log(`initializing ${Me.metadata.name} version ${Me.metadata.version}`);
}

function enable() {
  log(`enabling ${Me.metadata.name} version ${Me.metadata.version}`);
  try {
    Clock.enable();
  } catch (error) {
    logError(error);
  }
}

function disable() {
  log(`disabling ${Me.metadata.name} version ${Me.metadata.version}`);
  try {
    Clock.disable();
  } catch (error) {
    logError(error);
  }
}
