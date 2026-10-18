<script setup lang="ts">
import ProjectLogo from "../components/ProjectLogo.vue";
import { computed } from "vue";
import { useRoute } from "vue-router";
const route = useRoute();
const authentication = computed(
  () => route.name === "login" || route.name === "register",
);
</script>

<template>
  <main
    :class="
      authentication
        ? 'auth-layout mx-auto grid min-h-svh max-w-[1080px] grid-cols-[minmax(0,1fr)_minmax(0,460px)] items-center gap-20 px-10 py-12 max-md:block max-md:max-w-[500px] max-md:px-5 max-md:pt-6 max-md:pb-[calc(24px+env(safe-area-inset-bottom,0px))]'
        : 'mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-5 py-12'
    "
  >
    <header
      :class="{ 'flex flex-col self-stretch max-md:mb-5': authentication }"
    >
      <RouterLink
        to="/home"
        class="brand-link self-start"
        aria-label="禾伙搭，返回首页"
      >
        <ProjectLogo />
        <span
          ><strong class="font-serif text-xl">禾伙搭</strong
          ><small class="block text-xs text-muted"
            >校园比赛与项目组队平台</small
          ></span
        >
      </RouterLink>
      <div v-if="authentication" class="auth-story">
        <span class="hhr-badge hhr-badge--warning">在川农，找到同行的人</span>
        <h2 class="font-serif">一粒想法，<br />一群伙伴。</h2>
        <p>发现值得投入的比赛与项目，<br />和志同道合的伙伴，一起慢慢成长。</p>
        <div class="auth-story-line" aria-hidden="true"></div>
        <p class="auth-story-footnote">比赛发现 · 项目组队 · 校园协作</p>
      </div>
    </header>
    <div :class="{ 'min-w-0': authentication }">
      <RouterLink v-if="authentication" to="/home" class="auth-home-link"
        >← 返回首页</RouterLink
      >
      <RouterView :key="route.name" />
    </div>
  </main>
</template>
