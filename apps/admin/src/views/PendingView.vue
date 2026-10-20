<script setup lang="ts">
import { useRoute } from "vue-router";
import { Wrench } from "@lucide/vue";
const route = useRoute();
</script>
<template>
  <div class="page-heading">
    <div>
      <h1>{{ route.meta.title }}</h1>
      <p>管理端业务入口</p>
    </div>
  </div>
  <section class="panel empty-block">
    <Wrench :size="32" />
    <h2>{{ route.meta.title }}待接入</h2>
    <p>服务未开放，当前仅提供导航预览。</p>
    <RouterLink to="/" class="inline-link">返回工作台</RouterLink>
  </section>
</template>
