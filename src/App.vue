<template>
<main>
  <header>
    <h1>CircleCI 2 validator</h1>
    <p>Paste your CircleCI 2 <code>config.yml</code> to visualise it</p>
  </header>
  <input class="branch" type="text" v-model="branch">
  <codemirror v-model="config" />
  <div v-show="errorMessage" class="graph errorMessage">
    <h2>Error</h2>
    {{errorMessage}}
  </div>
  <div v-show="!errorMessage" class="graph"><svg><g/></svg></div>
  <footer>
    <a href="https://github.com/JackuB/circleci-workflow-validator">GitHub</a>
    &middot;
    <a href="https://mikul.as">J</a>
  </footer>
</main>
</template>

<script>
import * as d3 from 'd3';
import dagreD3 from 'dagre-d3';
import yaml from 'js-yaml';
import get from 'lodash/get';
import demo from './demo';

export default {
  name: 'app',
  data() {
    return {
      branch: 'master',
      errorMessage: null,
      config: demo,
    };
  },
  computed: {
    configjs() {
      try {
        const res = yaml.safeLoad(this.config);
        this.reportError(null);
        return res;
      } catch (error) {
        return this.reportError(error.message);
      }
    },
  },
  watch: {
    branch() { this.draw(); },
    configjs() {
      try {
        this.reportError(null);
        this.draw();
      } catch (error) {
        this.reportError('Error when drawing graph. Might be something wrong with the config.yml');
      }
    },
  },
  mounted() { this.draw(); },
  methods: {
    reportError(message) {
      this.errorMessage = message;
      return !message;
    },
    validate() {
      const config = this.configjs;
      if (!config.jobs) {
        return this.reportError('No jobs found in config.yml');
      }
      if (!config.workflows) {
        return this.reportError('No workflows found in config.yml');
      }
      return this.reportError(null);
    },
    draw() {
      if (this.errorMessage) { return; }
      if (!this.validate()) { return; }
      const data = this.configjs;

      // Cleanup previous render
      const svg = d3.select('.graph svg');
      svg.on('.zoom', null);
      svg.selectAll('svg').remove();
      svg.select('g').attr('transform', null);

      // Setup zoom support
      const inner = svg.select('g');
      const zoom = d3.zoom().on('zoom', () => inner.attr('transform', d3.event.transform));
      svg.call(zoom);

      const render = new dagreD3.render();

      // compound: true for clustering support
      const g = new dagreD3.graphlib.Graph({ compound: true });
      g.setGraph({
        nodesep: 70,
        ranksep: 50,
        rankdir: 'LR',
        marginx: 20,
        marginy: 20,
      });

      const jobsToConnect = [];

      // Go through all workflows
      Object.keys(data.workflows)
        .filter(k => k !== 'version')
        .forEach((workflowId) => {
          const workflow = data.workflows[workflowId];
          g.setNode(workflowId, {
            label: workflowId,
            clusterLabelPos: 'top',
            style: 'stroke: #ccc; fill: transparent',
          });

          // Iterate through jobs in the workflow
          workflow.jobs.forEach((jobObj) => {
            let jobId = jobObj;
            let job = {};
            if (typeof jobObj !== 'string') {
              jobId = Object.keys(jobObj)[0];
              job = jobObj[jobId];
            }

            const jobConfig = this.configjs.jobs[jobId];

            // For "only" skip everything else
            let branchesFilter = get(job, 'filters.branches.only');
            // Normalise
            if (typeof branchesFilter === 'string') { branchesFilter = [branchesFilter]; }
            if (branchesFilter) {
              // Pick and test regexes /___/
              const branchesFilterRegexes = branchesFilter.filter(f => /^\/.*\/$/.test(f));
              if (
                !branchesFilter.includes(this.branch)
                && !branchesFilterRegexes.filter(f => new RegExp(f.slice(1, -1)).test(this.branch)).length) {
                return;
              }
            }

            // For "ignore" skip if matches
            let branchesIgnore = get(job, 'filters.branches.ignore');
            // Normalise
            if (typeof branchesIgnore === 'string') { branchesIgnore = [branchesIgnore]; }
            if (branchesIgnore && branchesIgnore.includes(this.branch)) {
              return;
            }

            // For clustering of multiple workflows, we need to be able to have a job with multiple parents
            // This is not supported, so we create a copy with ID tied to a workflow it runs in
            const uuid = `${jobId}-${workflowId}`;

            let html = '<div class="nodeWrap">';
            html += `<div class="parallelism">${jobConfig.parallelism || 1}x</div>`;
            html += `<div class="name">${jobId}</div>`;
            html += '</div>';

            g.setNode(uuid, {
              labelType: 'html',
              label: html,
              rx: 5,
              ry: 5,
              padding: 0,
            });

            // Cluster jobs to a task
            g.setParent(uuid, workflowId);

            // Connect required jobs
            (job.requires || []).forEach((requiredJob) => {
              // Connect them later, when all jobs are on the graph
              // To allow workflow jobs in different order
              jobsToConnect.push({
                requiredJobUuid: `${requiredJob}-${workflowId}`,
                uuid,
              });
            });
          });
        });

      jobsToConnect.forEach(({ requiredJobUuid, uuid }) => {
        // If we can find the required job, connect them
        if (g.node(requiredJobUuid) && g.node(uuid)) {
          g.setEdge(requiredJobUuid, uuid, { width: 40 });
          // Else remove it, as it doesn't have its parent
        } else {
          g.removeNode(uuid);
        }
      });

      // Wait for next tick to prevent UI scaling issues
      this.$nextTick(() => {
        inner.call(render, g);

        // Zoom and scale to fit
        const graphWidth = g.graph().width + 80;
        const graphHeight = g.graph().height + 40;
        const width = parseInt(svg.style('width').replace(/px/, ''), 10);
        const height = parseInt(svg.style('height').replace(/px/, ''), 10);
        const zoomScale = Math.min(width / graphWidth, height / graphHeight);
        const translateX = (width / 2) - ((graphWidth * zoomScale) / 2);
        const translateY = (height / 2) - ((graphHeight * zoomScale) / 2);
        const svgZoom = svg;
        svgZoom.call(zoom.transform, d3.zoomIdentity.translate(translateX, translateY).scale(zoomScale));
      });
    },
  },
};
</script>

<style lang="scss">
$monofont: Consolas, "Liberation Mono", Courier, monospace;
$padding: 8px;

* {
  box-sizing: border-box;
}

body, html {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  margin: 0;
  padding: 0;
  font-size: 16px;
}

pre, code {
  font-family: $monofont
}

main {
  display: grid;
  width: 100vw;
  height: 100vh;
  grid-template-columns: 1fr 2fr;
  grid-template-rows: auto 1fr auto;
  grid-template-areas: "header branch"
                       "editor graph"
                       "footer graph";
}

.branch {
  grid-area: branch;
  font-size: 1.5rem;
  padding: $padding;
}

header {
  grid-area: header;
  padding: $padding;
  color: #606060;
  background: #f5f5f5;
  h1 {
    font-size: 1.4rem;
    margin: 0;
    font-weight: 100;
  }
  p {
    margin: 0;
    font-size: .8rem;
    font-weight: 100;
  }
}

.vue-codemirror {
  overflow: hidden;
}

.CodeMirror {
  grid-area: editor;
  height: 100%;
  position: relative;
}

footer {
  grid-area: footer;
  font-size: .7rem;
  padding: $padding;
  color: #606060;
  background: #f5f5f5;
  a {
    color: #606060;
    &:hover, &:focus {
      color: darken(#606060, 20);
    }
  }
}

.graph {
  grid-area: graph;
  background: #f5f5f5;
  font-family: $monofont;
  svg {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  text {
    font-weight: 300;
    font-size: 14px;
  }
  .node rect {
    stroke-width: 1px;
    stroke: #049B4A;
    fill: #fff;
  }
  .node g .nodeWrap {
    width: 200px;
    height: 40px;
    color: rgb(33, 33, 33);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px;
    .parallelism {
      line-height: 1;
      color: rgb(182, 182, 182);
      padding-right: 8px;
    }
    .name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  .edgeLabel text {
    width: 50px;
    fill: #000;
  }

  .edgePath path {
    stroke: #42c88a;
    stroke-width: 1.5px;
    fill: #42c88a;
  }
}

.errorMessage {
  color: #FF4136;
  padding: $padding;
}
</style>
