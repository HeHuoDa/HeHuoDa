<script setup lang="ts">
import { MapPin } from "@lucide/vue";
</script>
<template>
  <div class="not-found">
    <MapPin :size="44" />
    <p>404</p>
    <h1>没有找到这个页面</h1>
    <p>检查地址，或返回工作台继续处理内容。</p>
    <RouterLink to="/" class="primary-link">返回工作台</RouterLink>
  </div>
</template>
