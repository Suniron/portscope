<script setup lang="ts">
import type { Inventory } from '#shared/types/inventory'
import { fr } from '@nuxt/ui/locale'
import { httpAttemptUrl } from './utils/browser-url'
import { groupServices } from './utils/service-groups'

useHead({
  title: 'Portscope — Services locaux',
  htmlAttrs: { lang: 'fr' },
  meta: [{ name: 'description', content: 'Les services qui tournent sur votre machine, au même endroit.' }],
})

const query = ref('')
const automatic = ref(true)
const now = ref(Date.now())
const inventory = shallowRef<Inventory | null>(null)
const { data, error, status, refresh } = await useFetch<Inventory>('/api/inventory', {
  server: false,
  deep: false,
  timeout: 15_000,
  retry: 0,
})

watch(data, (value) => {
  if (value) inventory.value = value
}, { immediate: true })

const services = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  return (inventory.value?.services ?? [])
    .filter((service) => !search || [
      service.processName,
      service.pid,
      service.cwd,
      service.project?.name,
      service.project?.root,
      service.project?.branch,
      service.project?.worktree,
      ...service.endpoints.map((endpoint) => `${endpoint.address}:${endpoint.port}`),
    ].join(' ').toLocaleLowerCase().includes(search))
    .toSorted((a, b) => Math.min(...a.endpoints.map((e) => e.port)) - Math.min(...b.endpoints.map((e) => e.port)))
})

const endpointCount = computed(() =>
  inventory.value?.services.reduce((count, service) => count + service.endpoints.length, 0) ?? 0,
)
const serviceGroups = computed(() => groupServices(services.value, inventory.value?.homeDirectory))
const stale = computed(() =>
  inventory.value !== null && now.value - Date.parse(inventory.value.collectedAt) > 20_000,
)
const updatedAt = computed(() => inventory.value
  ? new Date(inventory.value.collectedAt).toLocaleTimeString('fr-FR')
  : null)
const stateLabel = computed(() => {
  if (error.value) return 'Actualisation interrompue'
  if (!inventory.value) return 'Collecte en cours'
  if (!automatic.value) return 'Actualisation en pause'
  if (stale.value) return 'Données anciennes'
  return 'À jour'
})

let interval: ReturnType<typeof setInterval> | undefined
const update = () => {
  now.value = Date.now()
  if (automatic.value && !document.hidden && status.value !== 'pending') void refresh()
}
onMounted(() => {
  interval = setInterval(update, 5_000)
  document.addEventListener('visibilitychange', update)
})
onBeforeUnmount(() => {
  clearInterval(interval)
  document.removeEventListener('visibilitychange', update)
})
watch(automatic, (enabled) => {
  if (enabled && status.value !== 'pending') void refresh()
})
</script>

<template>
  <UApp :locale="fr">
    <a class="skip-link" href="#inventory">Aller aux services</a>
    <header class="app-header">
      <div class="shell header-inner">
        <div class="app-heading">
          <span class="brand">
            <UIcon name="i-lucide-radio" aria-hidden="true" />
            Portscope
          </span>
          <h1 id="page-title">Services locaux</h1>
        </div>
        <span class="machine-label">
          <UIcon name="i-lucide-monitor" aria-hidden="true" />
          Cette machine
          <span v-if="inventory" class="platform">{{ inventory.platform }}</span>
        </span>
      </div>
    </header>

    <main id="inventory" class="shell workspace" tabindex="-1" aria-labelledby="page-title">
      <div class="toolbar">
        <div class="search-field">
          <label for="service-search" class="sr-only">Rechercher un port, un projet, une branche ou un dossier</label>
          <UInput
            id="service-search"
            v-model="query"
            type="search"
            icon="i-lucide-search"
            placeholder="Port, projet, branche, dossier…"
            size="md"
            class="w-full"
            :ui="{ base: 'placeholder:text-muted' }"
            autocomplete="off"
          />
        </div>
        <div class="refresh-controls">
          <USwitch v-model="automatic" label="Actualisation auto" size="sm" />
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="status === 'pending'"
            @click="refresh()"
          >
            Actualiser
          </UButton>
        </div>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-circle-alert"
        title="La collecte n’a pas abouti"
        :description="inventory
          ? 'Les derniers résultats restent affichés. Réessayez avec Actualiser ; si le problème persiste, consultez les journaux de Portscope.'
          : 'Réessayez avec Actualiser. Si le problème persiste, vérifiez les outils de collecte et les journaux de Portscope.'"
        role="alert"
        class="notice"
      />
      <UAlert
        v-if="inventory?.warnings.length"
        color="warning"
        variant="soft"
        icon="i-lucide-info"
        title="Certaines informations sont indisponibles"
        class="notice"
      >
        <template #description>
          <ul class="warning-list">
            <li v-for="warning in inventory.warnings" :key="warning">{{ warning }}</li>
          </ul>
        </template>
      </UAlert>

      <div class="inventory-summary">
        <p role="status" aria-live="polite">
          <template v-if="inventory">
            <strong>{{ services.length }}</strong>
            {{ services.length === 1 ? 'service' : 'services' }}
            <template v-if="query.trim()"> sur {{ inventory.services.length }}</template>
            <span v-else class="summary-detail"> · {{ endpointCount }} points d’écoute TCP</span>
          </template>
          <template v-else>Recherche des services en écoute…</template>
        </p>
        <div class="freshness">
          <span class="state" :class="{ 'state-warning': error || stale, 'state-paused': !automatic }">
            <span class="state-dot" aria-hidden="true" />
            {{ stateLabel }}
          </span>
          <span v-if="updatedAt" class="updated-at">
            <span class="sr-only">Dernière collecte </span>
            <time :datetime="inventory?.collectedAt">{{ updatedAt }}</time>
          </span>
        </div>
      </div>

      <div v-if="!inventory && status === 'pending'" class="empty-state" role="status">
        <UIcon name="i-lucide-radio" class="empty-icon" aria-hidden="true" />
        <h2>Lecture des ports en cours</h2>
        <p>Les services apparaîtront ici avec les informations disponibles.</p>
      </div>
      <div v-else-if="inventory && services.length === 0" class="empty-state">
        <UIcon :name="query.trim() ? 'i-lucide-search' : 'i-lucide-monitor'" class="empty-icon" aria-hidden="true" />
        <h2>{{ query.trim() ? 'Aucun service ne correspond' : 'Aucun service en écoute détecté' }}</h2>
        <p>{{ query.trim() ? 'Essayez un autre port, nom de projet ou dossier.' : 'Les services visibles par votre utilisateur apparaîtront automatiquement ici.' }}</p>
        <UButton v-if="query.trim()" color="neutral" variant="outline" @click="query = ''">
          Effacer la recherche
        </UButton>
      </div>

      <template v-else-if="services.length">
        <div class="list-head service-grid" aria-hidden="true">
          <span>Port / adresse</span>
          <span>Projet / processus</span>
          <span>Branche / worktree</span>
          <span>Dossier du processus</span>
        </div>
        <ul class="service-list" aria-label="Services en écoute">
          <template v-for="group in serviceGroups" :key="group.id">
            <li
              v-for="(service, index) in group.services"
              :key="service.id"
              class="service-row service-grid"
              :class="{ 'group-member': index < group.services.length - 1, 'group-continuation': index > 0 }"
            >
              <ul class="endpoints" aria-label="Points d’écoute">
                <li v-for="endpoint in service.endpoints" :key="`${endpoint.family}:${endpoint.address}:${endpoint.port}`">
                  <UButton
                    v-if="endpoint.url"
                    :to="endpoint.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="soft"
                    size="sm"
                    trailing-icon="i-lucide-arrow-up-right"
                    :aria-label="`Ouvrir ${endpoint.url} dans un nouvel onglet`"
                    class="port-link"
                  >
                    {{ endpoint.port }}
                  </UButton>
                  <template v-else>
                    <span class="port-number">{{ endpoint.port }}</span>
                    <UButton
                      v-if="httpAttemptUrl(endpoint)"
                      :to="httpAttemptUrl(endpoint)"
                      target="_blank"
                      rel="noopener noreferrer"
                      color="neutral"
                      variant="link"
                      size="xs"
                      trailing-icon="i-lucide-arrow-up-right"
                      :aria-label="`Essayer ${httpAttemptUrl(endpoint)} dans un nouvel onglet ; protocole non identifié`"
                      class="http-attempt"
                    >
                      Essayer HTTP
                    </UButton>
                    <span v-else class="unknown">Adresse non prise en charge par le navigateur</span>
                  </template>
                  <span class="endpoint-address">
                    {{ endpoint.address }}
                    <span v-if="!endpoint.url" class="protocol-label">TCP</span>
                  </span>
                </li>
              </ul>
              <div class="service-name">
                <h2>{{ service.project?.name ?? service.processName ?? 'Processus non identifié' }}</h2>
                <span class="process-detail">
                  {{ service.processName ?? 'Nom indisponible' }}
                  <span v-if="service.pid !== null"> · PID {{ service.pid }}</span>
                </span>
              </div>
              <div class="git-context">
                <template v-if="service.project">
                  <a
                    v-if="service.project.branchUrl"
                    :href="service.project.branchUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="branch-name branch-link"
                    :aria-label="`Ouvrir la branche distante associée à ${service.project.branch ?? service.project.name} dans un nouvel onglet`"
                  >
                    <UIcon name="i-lucide-git-branch" aria-hidden="true" />
                    {{ service.project.branch ?? 'Branche distante' }}
                    <UIcon name="i-lucide-arrow-up-right" aria-hidden="true" />
                  </a>
                  <span v-else class="branch-name">
                    <UIcon name="i-lucide-git-branch" aria-hidden="true" />
                    {{ service.project.branch ?? 'Branche non identifiée' }}
                  </span>
                  <span v-if="service.project.worktree" class="worktree-name">
                    <span class="sr-only">Worktree : </span>{{ service.project.worktree }}
                  </span>
                </template>
                <span v-else class="unknown">Contexte Git non identifié</span>
              </div>
              <div class="directory" :class="{ 'sr-only': index > 0 }">
                <code v-if="service.cwd">{{ service.cwd }}</code>
                <span v-else class="unknown">Dossier indisponible</span>
                <span v-if="group.services.length > 1 && index === 0" class="process-detail">
                  {{ group.services.length }} processus
                </span>
              </div>
            </li>
          </template>
        </ul>
      </template>

      <footer class="workspace-footer">
        <span>Un port ouvert ne signifie pas qu’un service est une application web.</span>
        <span>Lecture seule · {{ automatic ? 'Collecte toutes les 5 s, onglet visible' : 'Actualisation automatique en pause' }}</span>
      </footer>
    </main>
  </UApp>
</template>
