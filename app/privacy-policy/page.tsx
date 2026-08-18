import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Política de privacidad | Courtney Roberts",
  description: "Política de privacidad de Courtney Roberts.",
}

export default function PrivacyPolicyPage() {
  return (
    <main className="h-full overflow-y-auto bg-background px-5 py-10 sm:px-8">
      <article className="mx-auto w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-black/20 sm:p-10">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-primary">Courtney Roberts</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Política de privacidad</h1>
        <p className="mt-3 text-sm text-muted-foreground">Última actualización: 11 de agosto de 2026</p>

        <div className="mt-8 space-y-7 text-[15px] leading-7 text-slate-300">
          <section>
            <h2 className="text-lg font-semibold text-foreground">Información que recibimos</h2>
            <p className="mt-2">
              Courtney Roberts recibe el número de teléfono de WhatsApp y los mensajes que una persona envía voluntariamente al servicio.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Cómo usamos la información</h2>
            <p className="mt-2">
              Usamos esa información para recibir, procesar y responder las interacciones, además de operar, mantener y proteger el servicio.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Proveedores necesarios</h2>
            <p className="mt-2">
              Podemos procesar información mediante proveedores de infraestructura y mensajería que resulten necesarios para prestar el servicio. No vendemos información personal.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Conservación y eliminación</h2>
            <p className="mt-2">
              Conservamos la información sólo durante el tiempo razonablemente necesario para operar el servicio y atender solicitudes legítimas. Para solicitar la eliminación de datos asociados a una interacción, consultá las <a className="text-blue-400 underline decoration-blue-400/50 underline-offset-4 hover:text-blue-300" href="/data-deletion">instrucciones de eliminación de datos</a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Cambios</h2>
            <p className="mt-2">
              Podemos actualizar esta política cuando cambie el servicio o sus prácticas de privacidad. La fecha de actualización indica la versión vigente.
            </p>
          </section>
        </div>
      </article>
    </main>
  )
}
