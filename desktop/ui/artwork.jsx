import React from 'react'
import train from './assets/hero-train.png'
import morning from './assets/hero-morning.png'
import harvest from './assets/hero-harvest.png'
import rain from './assets/hero-rain.png'
import trainBlur from './assets/train-blur.png'
import morningBlur from './assets/morning-blur.png'
import harvestBlur from './assets/harvest-blur.png'
import trainThumb from './assets/garden-thumb.png'
import morningThumb from './assets/journey-thumb.png'
import harvestThumb from './assets/harvest-thumb.png'
import rainThumb from './assets/rain-thumb.png'
import nightThumb from './assets/night-thumb.png'
import dreamThumb from './assets/dream-thumb.png'
import morningTitle from './assets/morning-title.png'
import harvestTitle from './assets/harvest-title.png'
import shi from './assets/game-avatar.png'
import ke from './assets/avatar-ke.png'
import cocoa from './assets/avatar-ke2.png'
import fu from './assets/avatar-fu.png'
import miao from './assets/avatar-miao.png'
import guang from './assets/avatar-guang.png'

export const portraits = [shi, ke, cocoa, fu, miao, guang]
export const artwork = {
  train: { id: 'train', title: '樱花列车', image: train, thumb: trainThumb, blur: trainBlur, position: '50% 28%' },
  morning: { id: 'morning', title: '启程之朝', image: morning, thumb: morningThumb, blur: morningBlur, logo: morningTitle, position: '50% 72%' },
  harvest: { id: 'harvest', title: '摘桔子', image: harvest, thumb: harvestThumb, blur: harvestBlur, logo: harvestTitle, position: '50% 33%' },
  rain: { id: 'rain', title: '避雨', image: rain, thumb: rainThumb, blur: trainBlur, position: '80% 18%' },
  night: { title: '妙与喵', thumb: nightThumb },
  dream: { title: '幻梦', thumb: dreamThumb }
}
export const roleArt = { server: artwork.morning, client: artwork.train, capture: artwork.harvest }

export function ArtHero({ art, eyebrow, title, description, children, className = '' }) {
  return <section className={'art-hero art-' + art.id + ' ' + className}>
    <img className="art-hero-image" src={art.image} alt="" style={{ objectPosition: art.position }} />
    <div className="art-hero-overlay" />
    <div className="art-hero-copy"><span className="art-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p>{children}</div>
    <div className="art-signature">{art.logo && <img src={art.logo} alt="" />}<span>映像 · {art.title}</span></div>
  </section>
}

export function ArtLink({ art, title, description, onClick }) {
  return <button type="button" className="art-link" onClick={onClick}>
    <img src={art.thumb} alt="" /><span><strong>{title}</strong><small>{description}</small></span><span className="art-link-arrow">↗</span>
  </button>
}

export function ArtHeading({ title, description, art }) {
  return <div className="page-title art-page-heading"><div><h1>{title}</h1><p>{description}</p></div><div className="heading-frames" aria-hidden="true"><img src={art.thumb} alt="" /><img src={artwork.dream.thumb} alt="" /></div></div>
}
