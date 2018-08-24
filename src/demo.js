module.exports = `# This example is from:
# https://github.com/circleci/frontend
version: 2.0

references:

  container_config: &container_config
    docker:
      - image: clojure:lein-2.7.1
    working_directory: /root/frontend

  workspace_root: &workspace_root
    /tmp/workspace

  attach_workspace: &attach_workspace
    attach_workspace:
      at: *workspace_root

  restore_repo: &restore_repo
    restore_cache:
      keys:
        - v1-repo-{{ .Branch }}-{{ .Revision }}
        - v1-repo-{{ .Branch }}
        - v1-repo

  jars_cache_key: &jars_cache_key
    v7-dependency-jars-{{ checksum "project.clj" }}
  jars_backup_cache_key: &jars_backup_cache_key
    v7-dependency-jars

  restore_jars: &restore_jars
    restore_cache:
      keys:
        - *jars_cache_key
        - *jars_backup_cache_key

  npm_cache_key: &npm_cache_key
    v1-dependency-npm-{{ checksum "package.json" }}
  npm_backup_cache_key: &npm_backup_cache_key
    v1-dependency-npm

  restore_node_modules: &restore_node_modules
    restore_cache:
      keys:
        - *npm_cache_key
        - *npm_backup_cache_key

  bower_cache_key: &bower_cache_key
    v1-dependency-bower-{{ checksum "bower.json" }}
  bower_backup_cache_key: &bower_backup_cache_key
    v1-dependency-bower

  restore_bower_components: &restore_bower_components
    restore_cache:
      keys:
        - *bower_cache_key
        - *bower_backup_cache_key

jobs:
  checkout_code:
    <<: *container_config
    steps:
      - *restore_repo
      - checkout
      - save_cache:
          key: v1-repo-{{ .Branch }}-{{ .Revision }}
          paths:
            - .

  clojure_dependencies:
    parallelism: 4
    <<: *container_config
    steps:
      - *restore_repo
      - *restore_jars
      - run:
          command: lein deps
      - save_cache:
          key: *jars_cache_key
          paths:
            - /root/.m2

  npm_bower_dependencies:
    <<: *container_config
    docker:
      - image: node:4.8.3
    steps:
      - *restore_repo
      - *restore_node_modules
      - *restore_bower_components
      - run:
          name: download dependencies
          command: |
            if [ ! -d node_modules -o ! -d resources/components ]; then
              set -exu
              npm install
              node_modules/bower/bin/bower --allow-root install
            fi
      - save_cache:
          key: *npm_cache_key
          paths:
            - /root/frontend/node_modules
      - save_cache:
          key: *bower_cache_key
          paths:
            - /root/frontend/resources/components

  clojure_test:
    <<: *container_config
    steps:
      - *restore_repo
      - *restore_jars
      - run:
          name: lein test
          command: lein test

  cljs_test:
    docker:
      - image: docker:latest
        environment:
          IMAGE_TAG: ci-testing-image
    working_directory: /root/frontend
    steps:
      - setup_remote_docker:
          reusable: true
      # This is necessary because the docker:latest image doesn't have gnu tar
      - run:
          name: Install tar
          command: |
            set -x
            apk update
            apk add tar
      - *attach_workspace
      - *restore_repo
      - *restore_jars
      - *restore_node_modules
      - run:
          name: Restore compiled cljs from workspace
          command: |
            set -exu
            mkdir -p resources/public/cljs
            mv /tmp/workspace/compiled-cljs/test resources/public/cljs/
      - run:
          name: run tests
          command: |
            set -x
            docker build -t "$IMAGE_TAG" ci-testing-image
            CONTAINER_NAME=$(docker create $IMAGE_TAG bash -c 'cd /root/frontend && lein doo chrome-headless test once')
            docker cp . "$CONTAINER_NAME:/root/frontend"
            docker cp /root/.m2/. "$CONTAINER_NAME:/root/.m2"
            docker start -a $CONTAINER_NAME

  cljsbuild_whitespace:
    <<: *container_config
    steps:
      - *restore_repo
      - *restore_jars
      - run:
          name: cljsbuild whitespace
          command: lein cljsbuild once whitespace
      - run:
          name: Move compiled cljs to workspace
          command: |
            set -exu
            mkdir -p /tmp/workspace/compiled-cljs
            mv resources/public/cljs/whitespace /tmp/workspace/compiled-cljs/
      - persist_to_workspace:
          root: *workspace_root
          paths:
            - compiled-cljs/whitespace

  cljsbuild_production:
    <<: *container_config
    steps:
      - *restore_repo
      - *restore_jars
      - run:
          name: cljsbuild production
          command: lein cljsbuild once production
      - run:
          name: Move compiled cljs to workspace
          command: |
            set -exu
            mkdir -p /tmp/workspace/compiled-cljs
            mv resources/public/cljs/production /tmp/workspace/compiled-cljs/
      - persist_to_workspace:
          root: *workspace_root
          paths:
            - compiled-cljs/production

  cljsbuild_test:
    parallelism: 2
    <<: *container_config
    steps:
      - *restore_repo
      - *restore_jars
      - run:
          name: cljsbuild test
          command: lein cljsbuild once test
      - run:
          name: Move compiled cljs to workspace
          command: |
            set -exu
            mkdir -p /tmp/workspace/compiled-cljs
            mv resources/public/cljs/test /tmp/workspace/compiled-cljs/
      - persist_to_workspace:
          root: *workspace_root
          paths:
            - compiled-cljs/test

  precompile_assets:
    <<: *container_config
    steps:
      - *attach_workspace
      - *restore_repo
      - *restore_jars
      - *restore_node_modules
      - *restore_bower_components
      - run:
          name: Restore compiled cljs from workspace
          command: |
            set -exu
            mkdir -p resources/public/cljs
            mv /tmp/workspace/compiled-cljs/* resources/public/cljs/
      - run:
          name: Install node/npm
          command: |
            curl -sL https://deb.nodesource.com/setup_4.x | bash -
            apt-get install -y nodejs
      - run:
          name: precompile assets
          command: |
            source ~/.bashrc
            lein run -m frontend.tasks.http/precompile-assets
      - run:
          name: Move compiled assets to workspace
          command: mv resources /tmp/workspace/assets

      - persist_to_workspace:
          root: *workspace_root
          paths:
            - assets

  deploy:
    docker:
      - image: python:2.7
        environment:
          BUILD_JSON_PATH: integration-test-build.json
    working_directory: /root/frontend
    steps:
      - *attach_workspace
      - *restore_repo
      - run:
          name: Restore compiled assets from workspace
          command: |
            rm -r resources
            mv /tmp/workspace/assets resources
      - add-ssh-keys
      - run:
          name: Install AWS CLI
          command: pip install awscli
      - run:
          name: Install jq
          command: |
            apt-get update && apt-get install jq
      - run:
          name: deploy and trigger integration tests
          command: |
            set -ex
            ssh-add -D
            script/deploy.sh
            if [[ "\${CIRCLE_BRANCH}" == "master" ]]
            then
            curl https://api.rollbar.com/api/1/deploy/ \
            --form access_token=$ROLLBAR_ACCESS_TOKEN \
            --form environment=production \
            --form revision=$CIRCLE_SHA1 \
            --form local_username=$CIRCLE_USERNAME
            fi
      - run:
          name: Wait for deploy/integration tests to complete
          command: ./script/wait-for-deploy.sh

workflows:
  version: 2

  build_test_deploy:
    jobs:
      - checkout_code
      - clojure_dependencies:
          requires:
            - checkout_code
      - npm_bower_dependencies:
          requires:
            - checkout_code
      - clojure_test:
          requires:
            - clojure_dependencies
            - checkout_code
      - cljs_test:
          requires:
            - clojure_dependencies
            - npm_bower_dependencies
            - checkout_code
            - cljsbuild_test
      - cljsbuild_test:
          requires:
            - clojure_dependencies
            - checkout_code
      - cljsbuild_whitespace:
          requires:
            - clojure_dependencies
            - checkout_code
      - cljsbuild_production:
          requires:
            - clojure_dependencies
            - checkout_code
      - precompile_assets:
          requires:
            - clojure_dependencies
            - npm_bower_dependencies
            - cljsbuild_whitespace
            - cljsbuild_production
            - checkout_code
      - deploy:
          requires:
            - precompile_assets
            - cljs_test
            - clojure_test
            - checkout_code

dependencies:
  cache_directories:
    - "~/.cache/bower"
  post:
    - node_modules/bower/bin/bower install || (sleep 2; node_modules/bower/bin/bower install)
    - "[[ -d resources/components ]] || node_modules/bower/bin/bower install"
    - lein cljsbuild once whitespace test production
    - lein run -m frontend.tasks.http/precompile-assets


test:
  pre:
    - git grep --color TODO | cat
  post:
    - lein doo chrome test once

deployment:
  deploy:
    branch: /(?!master).+/
    commands:
      - script/deploy.sh
  track-master:
    branch: master
    commands:
      - script/deploy.sh
      - curl https://api.rollbar.com/api/1/deploy/
          --form access_token=$ROLLBAR_ACCESS_TOKEN
          --form environment=production
          --form revision=$CIRCLE_SHA1
          --form local_username=$CIRCLE_USERNAME
`;
