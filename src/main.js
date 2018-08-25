import Vue from 'vue';
import VueCodemirror from 'vue-codemirror';
import 'codemirror/mode/yaml/yaml';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/mdn-like.css';

import App from './App.vue';

Vue.config.productionTip = false;

Vue.use(VueCodemirror, {
  options: {
    theme: 'mdn-like',
    mode: 'text/x-yaml',
    lineNumbers: true,
    line: true,
  },
});

new Vue({
  render: h => h(App),
}).$mount('#app');
